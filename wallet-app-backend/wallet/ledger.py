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
from .events import notify
from .extensions import db
from .limits import limit_error
from .models import Notification, Transaction, User, Wallet
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

    # The day's cap is enforced here rather than on the client, for the same
    # reason the PIN is: otherwise the limit is a label, not a limit.
    refused = limit_error(sender_id, paise, settled_at)
    if refused:
        raise TransferRefused(refused)

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

    _announce(txn, sender_id, receiver_id, settled_at)
    return txn


def credit_wallet(
    user_id: int,
    paise: int,
    *,
    txn_type: str = "topup",
    note: str | None = None,
    when=None,
) -> Transaction:
    """Add money to a wallet and record it, atomically.

    Shared by top-ups and cashback credits so "money arrives" has one
    implementation: a reward that credits the balance through a second, subtly
    different code path is exactly how a reward ends up not appearing in the
    history.

    The caller owns the commit, as with `settle_transfer`.
    """
    settled_at = when or utcnow()

    credited = db.session.execute(
        update(Wallet)
        .where(Wallet.user_id == user_id)
        .values(balance_paise=Wallet.balance_paise + paise, updated_at=settled_at)
    )
    if credited.rowcount == 0:
        db.session.rollback()
        raise TransferRefused("Wallet not found!", 404)

    txn = Transaction(
        reference=make_reference(settled_at),
        type=txn_type,
        sender_id=None,
        receiver_id=user_id,
        amount_paise=paise,
        note=note,
        timestamp=settled_at,
    )
    db.session.add(txn)
    # Flush so the caller (and any notification) can use `txn.id` and
    # `txn.reference` without triggering a lazy load.
    db.session.flush()
    return txn


def _announce(txn: Transaction, sender_id: int, receiver_id: int, settled_at) -> None:
    """Tell both sides about a payment, once, for every path that moves money.

    Done here rather than in the transfer endpoint so that paying off a money
    request produces the same two inbox rows as a direct payment — the payer
    shouldn't get a different paper trail depending on who typed the amount.
    """
    people = {
        user.id: user
        for user in db.session.query(User)
        .filter(User.id.in_((sender_id, receiver_id)))
        .all()
    }
    sender_name = people[sender_id].name if people.get(sender_id) else None
    receiver_name = people[receiver_id].name if people.get(receiver_id) else None
    # No note means nothing to quote, so the body carries the one fact the row
    # does not already show: that the money actually moved.
    fallback = txn.note or "Completed"

    notify(
        receiver_id,
        Notification.MONEY_RECEIVED,
        f"Money received from {sender_name or 'another account'}",
        fallback,
        transaction=txn,
        when=settled_at,
    )
    notify(
        sender_id,
        Notification.MONEY_SENT,
        f"Money sent to {receiver_name or 'another account'}",
        fallback,
        transaction=txn,
        when=settled_at,
    )
