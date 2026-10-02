"""The inbox, written from one place.

Every event that is worth telling the user about goes through `notify()`, so the
wording lives in one file instead of being sprinkled across the blueprints that
happen to cause the event.

`notify()` deliberately never commits. A notification describes money that
moved, so it has to be written in the *same* database transaction as the money —
otherwise a rolled-back payment could still leave an inbox row claiming it
happened, and a successful one could vanish from the inbox. The caller owns the
commit, exactly as it does for `settle_transfer`.
"""

from .extensions import db
from .models import Notification
from .timeutils import utcnow

TITLE_LIMIT = 120
BODY_LIMIT = 200


def notify(
    user_id: int,
    kind: str,
    title: str,
    body: str | None = None,
    *,
    amount_paise: int | None = None,
    reference: str | None = None,
    transaction=None,
    when=None,
) -> Notification:
    """Queue one inbox row for `user_id` (see the module docstring on commits).

    Passing `transaction` links the row to the ledger entry it describes and
    fills in the reference from it, which is what makes a receipt reachable from
    the inbox without a second query.
    """
    if transaction is not None:
        amount_paise = transaction.amount_paise if amount_paise is None else amount_paise
        reference = reference or transaction.reference

    note = Notification(
        user_id=user_id,
        kind=kind,
        # Truncate rather than raise: a long payee name must not fail a payment.
        title=(title or "").strip()[:TITLE_LIMIT],
        body=(body or "").strip()[:BODY_LIMIT] or None,
        amount_paise=amount_paise,
        reference=reference,
        transaction_id=transaction.id if transaction is not None else None,
        is_read=False,
        created_at=when or utcnow(),
    )
    db.session.add(note)
    return note
