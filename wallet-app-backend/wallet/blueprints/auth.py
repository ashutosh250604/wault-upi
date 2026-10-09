import secrets
from datetime import timedelta

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.exc import IntegrityError

from .. import coins
from ..events import notify
from ..extensions import db
from ..models import Notification, User, Wallet
from ..otp import deliver_otp
from ..security import (
    EMAIL_RE,
    MOBILE_RE,
    PIN_RE,
    check_pin,
    current_user,
    hash_secret,
    require_auth,
    session_payload,
    verify_secret,
)
from ..timeutils import as_utc, utcnow

bp = Blueprint("auth", __name__)


def _generate_otp() -> str:
    return f"{secrets.randbelow(900000) + 100000}"


def _request_run(user, now) -> int:
    """How many codes this number has asked for in the current run.

    A run is the stretch of requests made while a code is still valid. Someone
    who asks twice, verifies, and then signs in again next week has not made
    three requests — the counter is per run, not per number, which is what
    "five continuous requests" means. The run ends on a successful verify (see
    `verify_otp`) or once the previous code has lapsed; the value here is only
    read, and `start_login` writes the incremented one back.
    """
    previous = as_utc(user.last_otp_sent_at) if user.last_otp_sent_at else None
    if previous is None:
        return 0
    if now - previous > timedelta(minutes=current_app.config["OTP_TTL_MINUTES"]):
        return 0
    return user.otp_requests or 0


def _cooldown_state(user, now, run: int):
    """The OTP throttle for this request, as data rather than prose.

    Returns `(wait_seconds, available_at)`. `wait_seconds` is 0 when the request
    may go ahead. Both are handed to the client so it can count the window down
    from a timestamp the server chose, instead of starting its own clock — a
    refresh, a backgrounded tab or a clock that ticks while the phone is asleep
    then all show the same remaining time.
    """
    cooldown = current_app.config["OTP_RESEND_SECONDS"]
    if cooldown <= 0 or run < current_app.config["OTP_FREE_REQUESTS"]:
        return 0, None
    previous = as_utc(user.last_otp_sent_at)
    if previous is None:
        return 0, None
    available_at = previous + timedelta(seconds=cooldown)
    waited = (now - previous).total_seconds()
    if waited >= cooldown:
        return 0, available_at
    return max(1, int(cooldown - waited + 0.999)), available_at


def _throttle_payload(wait: int, available_at, run: int) -> dict:
    """The 429 body: what to say, and the instant the wait is over."""
    return {
        "message": f"Please wait {wait} seconds before requesting a new OTP.",
        "retry_after": wait,
        "resend_available_at": available_at.isoformat() if available_at else None,
        "requests_remaining": 0,
        "requests_made": run,
    }


@bp.post("/start_login")
def start_login():
    data = request.get_json(silent=True) or {}
    mobile = (data.get("mobile") or "").strip()
    if not MOBILE_RE.match(mobile):
        return jsonify({"message": "Invalid mobile number"}), 400

    otp = _generate_otp()
    now = utcnow()
    user = User.query.filter_by(mobile=mobile).first()

    # The first few codes are free. Past that, one code per cooldown window:
    # issuing another would invalidate the code already on its way and let
    # anyone turn this endpoint into an SMS cannon. The client counts the same
    # window down, but the button is not what enforces it.
    run = _request_run(user, now) if user else 0
    wait, available_at = _cooldown_state(user, now, run) if user else (0, None)
    if wait > 0:
        return jsonify(_throttle_payload(wait, available_at, run)), 429

    if user is None:
        user = User(mobile=mobile)
        db.session.add(user)

    run += 1
    user.otp_hash = hash_secret(otp)
    user.otp_expiry = now + timedelta(minutes=current_app.config["OTP_TTL_MINUTES"])
    user.otp_attempts = 0
    user.otp_is_used = False
    user.last_otp_sent_at = now
    user.otp_requests = run
    user.updated_at = now

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"message": "Could not start login. Please try again."}), 500

    # Delivery is a seam (wallet/otp.py). Until an SMS gateway is configured it
    # reports that nothing was sent, and the code is exposed here instead: in the
    # response for the public demo, in the server log otherwise.
    free = current_app.config["OTP_FREE_REQUESTS"]
    next_available_at = (
        now + timedelta(seconds=current_app.config["OTP_RESEND_SECONDS"])
        if run >= free and current_app.config["OTP_RESEND_SECONDS"] > 0
        else None
    )
    payload = {
        "message": "OTP sent!",
        # How many of the free requests are left, and — once they run out — the
        # instant the next one may be made. The verify screen renders its
        # countdown from this rather than from its own 60-second guess.
        "requests_remaining": max(0, free - run),
        "resend_available_at": next_available_at.isoformat()
        if next_available_at
        else None,
    }
    if not deliver_otp(mobile, otp):
        if current_app.config["DEMO_MODE"]:
            payload["dev_otp"] = otp
        else:
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
    # The run is over: whoever this is has the code and is in. The next sign-in
    # starts with its free requests again.
    user.otp_requests = 0
    user.updated_at = utcnow()
    # Every real payment app mails you about a sign-in. Ours writes it to the
    # inbox instead, which is where the rest of the wallet's news lives.
    notify(
        user.id,
        Notification.SECURITY,
        "New sign-in to your wallet",
        f"Verified with a one-time code on {user.mobile}",
    )
    # The welcome bonus, in the same commit as the sign-in. Verifying a code is
    # the moment an account becomes real — it is the first thing a new number
    # does and the only thing every returning user does — and the grant is
    # idempotent, so "new" and "returning" need no branch here.
    coins.grant_signup_bonus(user.id)
    db.session.commit()

    return (
        jsonify(
            {
                "message": f"Welcome back, {user.name}!"
                if user.has_name
                else "OTP verified!",
                **session_payload(user.id),
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
    notify(
        user.id,
        Notification.SECURITY,
        "Payment PIN set",
        "Transfers and top-ups will ask for it before any money moves",
    )
    db.session.commit()

    return jsonify({"message": "PIN set successfully"}), 200


@bp.post("/verify_pin")
@require_auth
def verify_pin():
    data = request.get_json(silent=True) or {}
    pin = (data.get("pin") or "").strip()

    user = current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404

    # Same helper the debit endpoints use, so "verify" and "actually pay" can
    # never drift apart in lockout behaviour or attempt counting.
    message, status = check_pin(user, pin)
    if message:
        return jsonify({"message": message}), status

    return jsonify({"message": "PIN verified"}), 200


@bp.post("/demo_login")
def demo_login():
    """One-tap access to the pre-seeded sample account (only when DEMO_MODE is on)."""
    if not current_app.config["DEMO_MODE"]:
        return jsonify({"message": "Sample sign-in is disabled"}), 404

    mobile = current_app.config["DEMO_MOBILE"]
    user = User.query.filter_by(mobile=mobile).first()
    if user is None:
        return jsonify({"message": "Sample account is not seeded yet"}), 503

    # Deliberately no "new sign-in" note here, unlike the OTP flow: this account
    # is shared by every visitor, so one person's visit is not another's news.
    return jsonify(
        {
            "message": f"Welcome, {user.name or 'there'}!",
            **session_payload(user.id),
            "user_id": user.id,
            "mobile": user.mobile,
            "name": user.name,
            "vpa": user.vpa,
            "balance": round((user.wallet.balance_paise if user.wallet else 0) / 100, 2),
        }
    ), 200


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
