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


_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen",
]
_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
    "eighty", "ninety",
]


def _below_hundred(value: int) -> str:
    if value < 20:
        return _ONES[value]
    tens, ones = divmod(value, 10)
    return _TENS[tens] if ones == 0 else f"{_TENS[tens]} {_ONES[ones]}"


def _below_thousand(value: int) -> str:
    hundreds, rest = divmod(value, 100)
    if hundreds and rest:
        return f"{_ONES[hundreds]} hundred {_below_hundred(rest)}"
    if hundreds:
        return f"{_ONES[hundreds]} hundred"
    return _below_hundred(rest)


def rupees_in_words(amount) -> str:
    """A rupee amount in words, in the Indian system: "one thousand five hundred".

    A receipt that prints the figure twice, once in digits, once in words, is
    how a misheard zero is caught before it is paid. "₹15,000, fifteen thousand
    only" and "₹1,500, one thousand five hundred only" do not read alike, even
    though one keypad slip separates them.

    Returns "" for anything it cannot say honestly (negative, non-numeric, or
    implausibly large), so a caller can simply omit the line.
    """
    try:
        rupees = int(amount)
    except (TypeError, ValueError):
        return ""
    if rupees < 0 or rupees >= 10**9:
        return ""
    if rupees == 0:
        return "zero"

    parts = []
    crore, rupees = divmod(rupees, 10_000_000)
    lakh, rupees = divmod(rupees, 100_000)
    thousand, rupees = divmod(rupees, 1_000)
    if crore:
        parts.append(f"{_below_thousand(crore)} crore")
    if lakh:
        parts.append(f"{_below_thousand(lakh)} lakh")
    if thousand:
        parts.append(f"{_below_thousand(thousand)} thousand")
    if rupees:
        parts.append(_below_thousand(rupees))
    return " ".join(parts)
