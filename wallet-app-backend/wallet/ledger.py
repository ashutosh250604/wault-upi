"""Money movement, in one place.

Both a direct P2P payment and "pay off a request" are the same operation, so
they share this function rather than reimplementing the debit/credit dance —
which is exactly the kind of duplication that eventually lets one path check
the balance and the other forget to.
"""

from flask import current_app
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from .directory import stamp_last_paid
from .extensions import db
from .models import Transaction, Wallet
from .money import make_reference
from .timeutils import utcnow


class TransferRefused(Exception):
    """A payment that the ledger will not make, with the reason and HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


def settle_transfer(
    sender_id: int,
    receiver_id: int,
    paise: int,
    note: str | None = None,
) -> Transaction:
    """Atomically debit the sender and credit the receiver.

    The debit is a single conditional UPDATE, so a concurrent pair of payments
    can never overdraw a wallet. Raises `TransferRefused` instead of committing
    when the money can't move.

    The caller owns the commit on purpose: paying a request needs the transfer
    and the "request settled" flag to land as one transaction, so there is no
    window where a request is still pending but the money has moved.
    """
    if sender_id == receiver_id:
        raise TransferRefused("Sender and receiver cannot be the same!")

    limit_paise = current_app.config["MAX_TRANSFER_RUPEES"] * 100
    if paise > limit_paise:
        raise TransferRefused(
            f"Limit is ₹{current_app.config['MAX_TRANSFER_RUPEES']:,} per transaction"
        )

    settled_at = utcnow()

    debited = db.session.execute(
        update(Wallet)
        .where(Wallet.user_id == sender_id, Wallet.balance_paise >= paise)
        .values(balance_paise=Wallet.balance_paise - paise, updated_at=settled_at)
    )
    if debited.rowcount == 0:
        db.session.rollback()
        raise TransferRefused("Insufficient funds!")

    credited = db.session.execute(
        update(Wallet)
        .where(Wallet.user_id == receiver_id)
        .values(balance_paise=Wallet.balance_paise + paise, updated_at=settled_at)
    )
    if credited.rowcount == 0:
        db.session.rollback()
        raise TransferRefused("Receiver wallet not found!", 404)

    txn = Transaction(
        reference=make_reference(settled_at),
        type="transfer",
        sender_id=sender_id,
        receiver_id=receiver_id,
        amount_paise=paise,
        note=note,
        timestamp=settled_at,
    )
    db.session.add(txn)
    # If the payee is in the sender's address book, remember when they last paid
    # them — that is what makes "recent" ordering on the people strip honest.
    stamp_last_paid(sender_id, receiver_id, settled_at)

    try:
        db.session.flush()
    except IntegrityError as error:  # pragma: no cover - reference collisions only
        db.session.rollback()
        raise TransferRefused("Transfer failed, please retry.", 500) from error

    return txn
