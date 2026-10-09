import secrets
from decimal import Decimal, InvalidOperation

from .timeutils import to_ist, utcnow


def rupees_to_paise(raw):
    """Convert a rupee amount from an API request into integer paise.

    Returns (paise, error_message).
    """
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        return None, "Invalid amount value"
    if not value.is_finite():
        return None, "Invalid amount value"
    if value <= 0:
        return None, "Amount must be positive!"
    exact = value * 100
    if exact != exact.to_integral_value():
        return None, "Amount can have at most 2 decimal places"
    return int(exact), None


def paise_to_rupees(paise: int) -> float:
    return round(int(paise) / 100, 2)


def make_reference(when=None) -> str:
    """Human-friendly transaction reference, e.g. TXN20260926K7Q2MP.

    ``when`` lets the seeder stamp backdated rows with the date they actually
    happened instead of today's. The date part is IST, so a reference minted at
    2am carries the date the user is looking at rather than yesterday's.
    """
    date_part = to_ist(when or utcnow()).strftime("%Y%m%d")
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    random_part = "".join(secrets.choice(alphabet) for _ in range(6))
    return f"TXN{date_part}{random_part}"
