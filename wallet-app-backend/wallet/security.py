import re
from datetime import datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import current_app, g, jsonify, request

from .extensions import db
from .models import User
from .timeutils import as_utc, ist_date, to_ist, utcnow

MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PIN_RE = re.compile(r"^\d{4}$")

# The two kinds of token this app mints. A session opens the wallet; a PIN
# reset proves the phone and nothing else. They are told apart by the `typ`
# claim so one can never stand in for the other.
SESSION_TOKEN = "session"
RESET_TOKEN = "pin_reset"


def hash_secret(secret: str) -> str:
    """Salted scrypt hash — used for both PINs and OTP codes."""
    from werkzeug.security import generate_password_hash

    return generate_password_hash(secret, method="scrypt")


def verify_secret(hashed: str, secret: str) -> bool:
    from werkzeug.security import check_password_hash

    if not hashed:
        return False
    return check_password_hash(hashed, secret)


def token_ttl() -> timedelta:
    """How long a freshly issued session lasts."""
    return timedelta(minutes=current_app.config["JWT_EXPIRES_MINUTES"])


def token_expiry(now: datetime | None = None) -> datetime:
    """When a session issued at `now` lapses, as an aware UTC instant."""
    return (now or datetime.now(timezone.utc)) + token_ttl()


def issue_token(user_id: int, expires_at: datetime | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "typ": SESSION_TOKEN,
        "iat": now,
        "exp": expires_at or token_expiry(now),
    }
    return jwt.encode(
        payload,
        current_app.config["SECRET_KEY"],
        algorithm=current_app.config["JWT_ALGORITHM"],
    )


def issue_reset_token(user_id: int) -> str:
    """A short-lived proof that this number just passed an OTP check.

    Deliberately not a session: resetting a PIN proves the *phone*, so it buys
    the right to choose a new PIN and nothing else — it must not open the
    wallet, and it must not be usable as a Bearer token.
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "typ": RESET_TOKEN,
        "iat": now,
        "exp": now + timedelta(minutes=current_app.config["PIN_RESET_TTL_MINUTES"]),
    }
    return jwt.encode(
        payload,
        current_app.config["SECRET_KEY"],
        algorithm=current_app.config["JWT_ALGORITHM"],
    )


def session_payload(user_id: int) -> dict:
    """A new token, plus when it lapses — spelled out, in IST.

    Every sign-in response carries this. The client could read `exp` out of the
    token itself, but a session that says when it ends is one the UI can count
    down honestly instead of discovering the expiry with a 401 mid-payment.
    """
    expires_at = token_expiry()
    return {
        "token": issue_token(user_id, expires_at),
        "expires_at": to_ist(expires_at).isoformat(),
        "expires_in": int(token_ttl().total_seconds()),
    }


def _decode(token: str, expect: str):
    """The user id a valid token of the expected kind stands for, or None."""
    try:
        payload = jwt.decode(
            token,
            current_app.config["SECRET_KEY"],
            algorithms=[current_app.config["JWT_ALGORITHM"]],
        )
    except jwt.PyJWTError:
        return None
    # Every token minted before the two kinds were told apart was a session, so
    # a missing claim is read as one rather than as grounds for a 401.
    if payload.get("typ", SESSION_TOKEN) != expect:
        return None
    try:
        return int(payload.get("sub"))
    except (TypeError, ValueError):
        return None


def decode_token(token: str):
    """The session token's user id, or None. A reset token is not a session."""
    return _decode(token, SESSION_TOKEN)


def decode_reset_token(token: str):
    """The user id a PIN-reset token stands for, or None."""
    return _decode(token, RESET_TOKEN)


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

    # Five wrong attempts *a day*: the count is kept against an IST date, so a
    # new day starts it over even though the rows are only ever written here.
    # Recomputing it from the last failure instead would mean a user who typed
    # three wrong PINs at 11:59pm keeps them at 00:01am.
    today = ist_date()
    if user.pin_attempts_date != today:
        user.pin_attempts = 0
        user.pin_attempts_date = today

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
