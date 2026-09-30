import re
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from .extensions import db
from .models import User
from .timeutils import as_utc, utcnow

MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PIN_RE = re.compile(r"^\d{4}$")


def hash_secret(secret: str) -> str:
    """Salted scrypt hash — used for both PINs and OTP codes."""
    from werkzeug.security import generate_password_hash

    return generate_password_hash(secret, method="scrypt")


def verify_secret(hashed: str, secret: str) -> bool:
    from werkzeug.security import check_password_hash

    if not hashed:
        return False
    return check_password_hash(hashed, secret)


def issue_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(hours=current_app.config["JWT_EXPIRES_HOURS"]),
    }
    return jwt.encode(
        payload,
        current_app.config["SECRET_KEY"],
        algorithm=current_app.config["JWT_ALGORITHM"],
    )


def decode_token(token: str):
    try:
        payload = jwt.decode(
            token,
            current_app.config["SECRET_KEY"],
            algorithms=[current_app.config["JWT_ALGORITHM"]],
        )
    except jwt.PyJWTError:
        return None
    try:
        return int(payload.get("sub"))
    except (TypeError, ValueError):
        return None


def auth_error(message="Authentication required"):
    return jsonify({"message": message}), 401


def require_auth(view):
    """Populates g.user_id from the Bearer token or returns 401."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return auth_error()
        user_id = decode_token(header[len("Bearer ") :].strip())
        if not user_id:
            return auth_error("Invalid or expired session. Please log in again.")
        g.user_id = user_id
        return view(*args, **kwargs)

    return wrapper


def current_user() -> User:
    return db.session.get(User, g.user_id)


def pin_is_locked(user: User):
    locked_until = as_utc(user.pin_locked_until)
    if locked_until and utcnow() < locked_until:
        minutes = max(1, int((locked_until - utcnow()).total_seconds() // 60) + 1)
        return f"PIN locked after too many wrong attempts. Try again in {minutes} minute(s)."
    return None


def check_pin(user: User, pin: str) -> tuple[str | None, int]:
    """Verify a PIN against the full lockout policy.

    Returns `(message, status)` when the PIN can't be accepted, or `(None, 200)`.

    Every debit path goes through here — approvals and transfers alike — so a
    payment can never be authorised by a weaker check than the one the PIN
    screen performs, and the attempt counter can't be sidestepped by choosing a
    different endpoint.
    """
    if not PIN_RE.match(pin or ""):
        return "Invalid PIN format", 400
    if not user.pin_hash:
        return "PIN not set. Please set PIN first.", 403

    locked = pin_is_locked(user)
    if locked:
        return locked, 403

    if verify_secret(user.pin_hash, pin):
        user.pin_attempts = 0
        user.pin_locked_until = None
        return None, 200

    user.pin_attempts += 1
    max_attempts = current_app.config["PIN_MAX_ATTEMPTS"]
    if user.pin_attempts >= max_attempts:
        lock_minutes = current_app.config["PIN_LOCK_MINUTES"]
        user.pin_locked_until = utcnow() + timedelta(minutes=lock_minutes)
        user.pin_attempts = 0
        db.session.commit()
        return f"Too many wrong attempts. PIN locked for {lock_minutes} minutes.", 403

    remaining = max_attempts - user.pin_attempts
    db.session.commit()
    return f"Incorrect PIN. {remaining} attempt(s) left.", 403
