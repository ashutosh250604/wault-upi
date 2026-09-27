import secrets
from datetime import timedelta

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash

from ..extensions import db
from ..models import User, Wallet
from ..security import (
    EMAIL_RE,
    MOBILE_RE,
    PIN_RE,
    current_user,
    hash_secret,
    issue_token,
    pin_is_locked,
    require_auth,
    verify_secret,
)
from ..timeutils import as_utc, utcnow

bp = Blueprint("auth", __name__)


def _generate_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000}"


@bp.post("/start_login")
def start_login():
    data = request.get_json(silent=True) or {}
    mobile = (data.get("mobile") or "").strip()
    if not MOBILE_RE.match(mobile):
        return jsonify({"message": "Invalid mobile number"}), 400

    otp = _generate_otp()
    now = utcnow()
    user = User.query.filter_by(mobile=mobile).first()
    if user is None:
        user = User(mobile=mobile)
        db.session.add(user)

    user.otp_hash = hash_secret(otp)
    user.otp_expiry = now + timedelta(minutes=current_app.config["OTP_TTL_MINUTES"])
    user.otp_attempts = 0
    user.otp_is_used = False
    user.last_otp_sent_at = now
    user.updated_at = now

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"message": "Could not start login. Please try again."}), 500

    payload = {"message": "OTP sent!"}
    if current_app.config["DEMO_MODE"]:
        # Public demo: no SMS provider, so the OTP is returned for the UI to display.
        payload["dev_otp"] = otp
    else:
        # Console SMS provider (development / self-hosted).
        current_app.logger.info("OTP for %s: %s", mobile, otp)

    return jsonify(payload), 200


@bp.post("/verify_otp")
def verify_otp():
    data = request.get_json(silent=True) or {}
    mobile = (data.get("mobile") or "").strip()
    otp = (data.get("otp") or "").strip()

    if not MOBILE_RE.match(mobile):
        return jsonify({"message": "Invalid mobile number"}), 400
    if not otp:
        return jsonify({"message": "OTP is required"}), 400

    user = User.query.filter_by(mobile=mobile).first()
    if user is None:
        return jsonify({"message": "User not found. Please request a new OTP."}), 404
    if user.otp_is_used:
        return jsonify({"message": "OTP already used. Please request a new one."}), 400
    if user.otp_attempts >= current_app.config["OTP_MAX_ATTEMPTS"]:
        return jsonify(
            {"message": "Too many wrong attempts. Please request a new OTP."}
        ), 403

    expiry = as_utc(user.otp_expiry)
    if not user.otp_hash or not expiry or utcnow() > expiry:
        return jsonify({"message": "OTP expired. Please request a new one."}), 400

    if not verify_secret(user.otp_hash, otp):
        user.otp_attempts += 1
        db.session.commit()
        remaining = max(0, current_app.config["OTP_MAX_ATTEMPTS"] - user.otp_attempts)
        return jsonify({"message": f"Invalid OTP. {remaining} attempt(s) left."}), 400

    user.otp_is_used = True
    user.is_verified = True
    user.updated_at = utcnow()
    db.session.commit()

    return (
        jsonify(
            {
                "message": f"Welcome back, {user.name}!"
                if user.has_name
                else "OTP verified!",
                "token": issue_token(user.id),
                "user_id": user.id,
                "name": user.name,
                "vpa": user.vpa,
                "ask_name": not user.has_name,
            }
        ),
        200,
    )


@bp.post("/set_name")
@require_auth
def set_name():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip() or None

    if not name:
        return jsonify({"message": "Name is required"}), 400
    if email and not EMAIL_RE.match(email):
        return jsonify({"message": "Invalid email format"}), 400

    user = current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404
    if not user.is_verified:
        return jsonify({"message": "OTP verification required before setting name"}), 403

    if email:
        existing = User.query.filter(User.email == email, User.id != user.id).first()
        if existing:
            return jsonify({"message": "Email is already registered"}), 409

    user.name = name
    user.email = email
    user.vpa = user.vpa or f"{user.mobile}@{current_app.config['VPA_SUFFIX']}"
    user.updated_at = utcnow()
    if user.wallet is None:
        user.wallet = Wallet(user_id=user.id, balance_paise=0)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"message": "Email or UPI ID is already registered"}), 409

    return jsonify(
        {
            "message": f"Name, email, and UPI ID set! Welcome, {name}.",
            "user_id": user.id,
            "vpa": user.vpa,
        }
    ), 200


@bp.post("/set_pin")
@require_auth
def set_pin():
    data = request.get_json(silent=True) or {}
    pin = (data.get("pin") or "").strip()

    if not PIN_RE.match(pin):
        return jsonify({"message": "PIN must be exactly 4 digits"}), 400

    user = current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404
    if not user.is_verified:
        return jsonify({"message": "OTP verification required before setting PIN"}), 403

    user.pin_hash = hash_secret(pin)
    user.pin_attempts = 0
    user.pin_locked_until = None
    user.updated_at = utcnow()
    db.session.commit()

    return jsonify({"message": "PIN set successfully"}), 200


@bp.post("/verify_pin")
@require_auth
def verify_pin():
    data = request.get_json(silent=True) or {}
    pin = (data.get("pin") or "").strip()

    if not PIN_RE.match(pin):
        return jsonify({"message": "Invalid PIN format"}), 400

    user = current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404
    if not user.pin_hash:
        return jsonify({"message": "PIN not set. Please set PIN first."}), 403

    locked_message = pin_is_locked(user)
    if locked_message:
        return jsonify({"message": locked_message}), 403

    if not check_password_hash(user.pin_hash, pin):
        user.pin_attempts += 1
        if user.pin_attempts >= current_app.config["PIN_MAX_ATTEMPTS"]:
            user.pin_locked_until = utcnow() + timedelta(
                minutes=current_app.config["PIN_LOCK_MINUTES"]
            )
            user.pin_attempts = 0
            db.session.commit()
            return jsonify(
                {
                    "message": "Too many wrong attempts. PIN locked for "
                    f"{current_app.config['PIN_LOCK_MINUTES']} minutes."
                }
            ), 403
        remaining = current_app.config["PIN_MAX_ATTEMPTS"] - user.pin_attempts
        db.session.commit()
        return jsonify({"message": f"Incorrect PIN. {remaining} attempt(s) left."}), 403

    user.pin_attempts = 0
    user.pin_locked_until = None
    db.session.commit()
    return jsonify({"message": "PIN verified"}), 200


@bp.post("/demo_login")
def demo_login():
    """One-tap access to the seeded demo account (only when DEMO_MODE is on)."""
    if not current_app.config["DEMO_MODE"]:
        return jsonify({"message": "Demo login is disabled"}), 404

    mobile = current_app.config["DEMO_MOBILE"]
    user = User.query.filter_by(mobile=mobile).first()
    if user is None:
        return jsonify({"message": "Demo account is not seeded yet"}), 503

    return jsonify(
        {
            "message": f"Demo login successful. Welcome, {user.name or 'there'}!",
            "token": issue_token(user.id),
            "user_id": user.id,
            "mobile": user.mobile,
            "name": user.name,
            "vpa": user.vpa,
            "balance": round((user.wallet.balance_paise if user.wallet else 0) / 100, 2),
        }
    ), 200


@bp.get("/get_user_id")
@require_auth
def get_user_id():
    mobile = (request.args.get("mobile") or "").strip()
    if not mobile:
        return jsonify({"user_id": g.user_id}), 200

    user = User.query.filter_by(mobile=mobile).first()
    if user is None:
        return jsonify({"message": "User not found"}), 404
    return jsonify({"user_id": user.id}), 200


@bp.get("/me")
@require_auth
def me():
    user = current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404
    payload = user.to_public_dict()
    payload["balance"] = round(
        (user.wallet.balance_paise if user.wallet else 0) / 100, 2
    )
    # Lets the client send a half-onboarded account back to the PIN step even
    # if it never learns that from the sign-in response.
    payload["has_pin"] = bool(user.pin_hash)
    return jsonify(payload), 200
