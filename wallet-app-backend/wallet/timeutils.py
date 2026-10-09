"""Time, resolved in exactly two places.

The app has one rule about clocks: **store and compare in UTC, show in IST**.
Every timestamp in the database is UTC, every window a query filters on is
converted to UTC before it touches SQL, and every string a human reads is
rendered in Asia/Kolkata. Keeping that conversion at the edges is what stops a
timestamp from meaning two different things in two different files — which is
how a payment made at 2am IST ends up in the previous day's statement.

`IST` is a fixed +05:30 offset rather than a tz database lookup: India has had
no daylight saving since 1945, so the offset is a constant and the app does not
need `zoneinfo` (or its tzdata) to be installed on the host.
"""

from datetime import date, datetime, timedelta, timezone

# Asia/Kolkata. Fixed offset, no DST — see the module docstring.
IST = timezone(timedelta(minutes=330), "IST")

# DD-MM-YYYY, the format every date in the app and on a statement is printed in.
DATE_FORMAT = "%d-%m-%Y"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ist_now() -> datetime:
    return datetime.now(IST)


def as_utc(value):
    """Normalize SQLite's naive datetimes to UTC-aware ones."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def to_ist(value):
    """The same instant, on the clock the user is looking at.

    Naive datetimes are read as UTC, because that is what everything written
    through `utcnow()` is. A store that hands back a naive one is not a signal
    that it meant local time.
    """
    if value is None:
        return None
    return as_utc(value).astimezone(IST)


def ist_date(value=None) -> date:
    """The IST calendar day of an instant — now, by default.

    Day boundaries in this app are Indian ones: a counter that resets "tomorrow"
    resets at midnight in Asia/Kolkata, which is 18:30 UTC the evening before.
    """
    return to_ist(value or utcnow()).date()


def format_date(value) -> str:
    """DD-MM-YYYY, in IST."""
    stamp = to_ist(value)
    return stamp.strftime(DATE_FORMAT) if stamp else ""


def format_time(value) -> str:
    """HH:MM, in IST."""
    stamp = to_ist(value)
    return stamp.strftime("%H:%M") if stamp else ""


def format_datetime(value) -> str:
    """DD-MM-YYYY, HH:MM, in IST."""
    stamp = to_ist(value)
    return stamp.strftime(f"{DATE_FORMAT}, %H:%M") if stamp else ""
