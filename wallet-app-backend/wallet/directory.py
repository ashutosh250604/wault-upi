"""Payee lookup, shared by the scanner, the pay sheet and the address book.

Every "who am I paying?" path funnels through here so a UPI ID typed into the
scanner resolves exactly like one saved from the contacts screen.
"""

import re

from .models import Contact, User
from .timeutils import utcnow

# Indian mobile numbers: 10 digits, first digit 6-9. Accepts +91/0 prefixes and
# stray spaces or dashes, because that is what people actually paste.
_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
_NON_DIGITS = re.compile(r"\D")


def normalise_mobile(raw) -> str | None:
    """Return the bare 10-digit mobile, or None when it isn't a valid number."""
    digits = _NON_DIGITS.sub("", str(raw or ""))
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    return digits if _MOBILE_RE.match(digits) else None


def normalise_vpa(raw) -> str | None:
    """Lower-cased `name@handle`, or None when it doesn't look like a UPI ID."""
    vpa = str(raw or "").strip().lower()
    if "@" not in vpa or vpa.startswith("@") or vpa.endswith("@"):
        return None
    return vpa


def classify_identifier(raw) -> tuple[str | None, str | None]:
    """Split a typed identifier into (vpa, mobile) — at most one is set."""
    text = str(raw or "").strip()
    if not text:
        return None, None
    if "@" in text:
        return normalise_vpa(text), None
    return None, normalise_mobile(text)


def find_payee(vpa=None, mobile=None) -> User | None:
    """Look up the wallet behind a UPI ID or a mobile number."""
    if vpa:
        return User.query.filter(User.vpa.ilike(vpa)).first()
    if mobile:
        return User.query.filter_by(mobile=mobile).first()
    return None


def stamp_last_paid(owner_id: int, payee_id: int, when=None) -> None:
    """Record that `owner_id` just paid `payee_id`, when they are a saved contact.

    Called from /transfer so "recently paid" ordering on the contacts screen is
    driven by real payments instead of a separate counter that can drift.

    `when` falls back to now: a column default only fills the value at INSERT,
    so a freshly built row still carries None for its timestamp.
    """
    stamp = when or utcnow()
    contact = Contact.query.filter_by(owner_id=owner_id, payee_id=payee_id).first()
    if contact is not None:
        contact.last_paid_at = stamp
        contact.updated_at = stamp
