"""Spending limits, in one place.

Two questions that must never disagree: "how much can I still spend today?" and
"may this debit go through at all?". Both read the window from here, so the
number the amount screen shows the user and the number the server enforces are
the same number.

The day is measured in IST rather than UTC — the users are in India, so a cap
that reset at 05:30 in the morning would look arbitrary. Timestamps stay in UTC;
the offset is only used to work out where the day starts and ends.
"""

from datetime import datetime, timedelta

from flask import current_app
from sqlalchemy import func

from .extensions import db
from .models import Transaction
from .money import paise_to_rupees
from .timeutils import as_utc, utcnow


def _offset() -> timedelta:
    """Minutes to add to UTC to get the limit day's local time."""
    return timedelta(minutes=current_app.config["LIMIT_TZ_OFFSET_MINUTES"])


def day_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    """(start, end) of the current limit day, in UTC.

    `end` is also the moment the cap resets, which is what the API reports as
    `resets_at`.
    """
    offset = _offset()
    local_now = (now or utcnow()) + offset
    local_start = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    start = local_start - offset
    return start, start + timedelta(days=1)


def daily_limit_paise() -> int:
    return int(current_app.config["MAX_DAILY_RUPEES"]) * 100


def spent_today_paise(user_id: int, now: datetime | None = None) -> int:
    """What this user has sent out today, excluding money that came in.

    Only outgoing transfers count. A top-up or a cashback credit is money
    arriving, and charging it against a *spending* cap would be nonsense.
    """
    start, end = day_window(now)
    total = (
        db.session.query(func.coalesce(func.sum(Transaction.amount_paise), 0))
        .filter(
            Transaction.sender_id == user_id,
            Transaction.type == "transfer",
            Transaction.status == "success",
            Transaction.timestamp >= start,
            Transaction.timestamp < end,
        )
        .scalar()
    )
    return int(total or 0)


def snapshot(user_id: int, now: datetime | None = None) -> dict:
    """What the limit card renders: cap, spend so far, and when it resets."""
    limit_paise = daily_limit_paise()
    spent = spent_today_paise(user_id, now)
    remaining = max(0, limit_paise - spent)
    _, end = day_window(now)
    return {
        "daily_limit": paise_to_rupees(limit_paise),
        "spent_today": paise_to_rupees(spent),
        "remaining": paise_to_rupees(remaining),
        "per_transaction": current_app.config["MAX_TRANSFER_RUPEES"],
        "used_percent": round(spent / limit_paise * 100, 1) if limit_paise else 0.0,
        "resets_at": as_utc(end).isoformat(),
    }


def limit_error(user_id: int, paise: int, now: datetime | None = None) -> str | None:
    """The refusal to show when this debit would break today's cap, else None.

    A cap of zero disables the check, which is how a self-hosted instance turns
    the demo-ish ceiling off without patching code.
    """
    limit_paise = daily_limit_paise()
    if limit_paise <= 0:
        return None

    remaining = limit_paise - spent_today_paise(user_id, now)
    if paise <= remaining:
        return None

    if remaining <= 0:
        return (
            f"You've reached today's limit of ₹{paise_to_rupees(limit_paise):,.0f}. "
            "It resets at midnight."
        )
    return (
        f"Only ₹{paise_to_rupees(remaining):,.2f} of today's "
        f"₹{paise_to_rupees(limit_paise):,.0f} limit is left."
    )
