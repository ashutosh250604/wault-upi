"""The inbox: what the wallet has to say, and what it still owes you.

Three closely related things live here because they are read together — the bell,
the offers strip and the coin chip all sit on the home screen.

Notifications are a log of things that already happened and can be deleted
freely; rewards are a promise about things that haven't happened yet and are
settled by the payment paths, not by this screen; coins are the sum of an award
log that only `wallet/coins.py` writes, and of the two things a caller can do
here, only a redemption writes anything at all.
"""

from flask import Blueprint, g, jsonify, request

from ..coins import (
    CoinError,
    card_collection,
    card_view,
    redeem,
    scratch_card,
    snapshot,
)
from ..extensions import db
from ..models import Notification, Wallet
from ..money import paise_to_rupees
from ..rewards import ensure_rewards, list_for
from ..security import require_auth

bp = Blueprint("inbox", __name__)

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _unread_count() -> int:
    return Notification.query.filter_by(user_id=g.user_id, is_read=False).count()


def _own(note_id: int) -> Notification | None:
    """Load an inbox row only if it belongs to the caller.

    A stranger's id answers exactly like a missing one: an inbox shouldn't be
    probeable for which notification ids exist.
    """
    note = db.session.get(Notification, note_id)
    if note is None or note.user_id != g.user_id:
        return None
    return note


@bp.get("/notifications")
@require_auth
def list_notifications():
    """Newest first, bundled with the unread count the bell renders.

    An object rather than a bare array (as /requests and /contacts return)
    because every screen's bell needs the count, and a second round trip for one
    integer is a worse trade than a slightly different response shape.
    """
    limit = request.args.get("limit", default=DEFAULT_LIMIT, type=int)
    limit = min(max(limit or DEFAULT_LIMIT, 1), MAX_LIMIT)

    rows = (
        Notification.query.filter_by(user_id=g.user_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
        .all()
    )
    return (
        jsonify(
            {
                "unread_count": _unread_count(),
                "notifications": [row.to_dict() for row in rows],
            }
        ),
        200,
    )


@bp.post("/notifications/<int:note_id>/read")
@require_auth
def mark_read(note_id):
    note = _own(note_id)
    if note is None:
        return jsonify({"message": "Notification not found"}), 404

    if not note.is_read:
        note.is_read = True
        db.session.commit()

    return (
        jsonify({"notification": note.to_dict(), "unread_count": _unread_count()}),
        200,
    )


@bp.post("/notifications/read-all")
@require_auth
def mark_all_read():
    marked = Notification.query.filter_by(user_id=g.user_id, is_read=False).update(
        {"is_read": True}
    )
    db.session.commit()
    return (
        jsonify(
            {
                "message": "Inbox cleared of unread items"
                if marked
                else "Nothing was unread",
                "marked": marked,
                "unread_count": 0,
            }
        ),
        200,
    )


@bp.delete("/notifications/<int:note_id>")
@require_auth
def delete_notification(note_id):
    """Removing a notification never touches money — it is only a note about it."""
    note = _own(note_id)
    if note is None:
        return jsonify({"message": "Notification not found"}), 404

    db.session.delete(note)
    db.session.commit()
    return jsonify({"message": "Removed", "unread_count": _unread_count()}), 200


@bp.get("/rewards")
@require_auth
def list_rewards():
    """This user's offers, best-looking first.

    Opening the screen is what activates an offer for a brand-new account, so
    this endpoint may write. It commits only when it actually changed something,
    which keeps a plain read from holding a write transaction open.
    """
    rows = ensure_rewards(g.user_id)
    if db.session.new or db.session.dirty:
        db.session.commit()
    return jsonify(list_for(rows)), 200


@bp.get("/coins")
@require_auth
def coin_snapshot():
    """The coin chip's numbers: balance, worth, and progress to the next coin.

    A pure read — coins earned are counted from the ledger, so nothing here has
    to be kept up to date or reconciled.
    """
    return jsonify(snapshot(g.user_id)), 200


@bp.get("/scratch-cards")
@require_auth
def list_scratch_cards():
    """Every scratch card the user holds, newest first.

    A pure read, and a card that has not been scratched deliberately does not
    carry its coins: the cover is the point of the card, and the collection
    screen exists to show which ones are still to be opened.
    """
    return jsonify(card_collection(g.user_id)), 200


@bp.post("/scratch-cards/<int:card_id>/scratch")
@require_auth
def scratch_scratch_card(card_id):
    """Reveal one card's coins.

    Nothing moves here — the draw was credited with the payment that won it, in
    that payment's own commit. This writes down only that the user has seen it,
    which is what takes the card out of the unscratched pile; a card that is
    already scratched, or is not the caller's, is refused rather than stamped.
    """
    try:
        card = scratch_card(g.user_id, card_id)
    except CoinError as refusal:
        return jsonify({"message": refusal.message}), refusal.status

    db.session.commit()
    return (
        jsonify({"card": card_view(g.user_id, card), "coins": snapshot(g.user_id)}),
        200,
    )


@bp.post("/coins/redeem")
@require_auth
def redeem_coins():
    """Spend coins for wallet credit.

    The credit, the redemption record and the inbox note are queued in one
    commit, so coins can't be marked spent without the money arriving.
    """
    data = request.get_json(silent=True) or {}
    try:
        coins, txn = redeem(g.user_id, data.get("coins"))
    except CoinError as refusal:
        return jsonify({"message": refusal.message}), refusal.status

    db.session.commit()

    wallet = Wallet.query.filter_by(user_id=g.user_id).first()
    return (
        jsonify(
            {
                "message": f"₹{paise_to_rupees(txn.amount_paise):,.2f} added from "
                f"{coins} {'coin' if coins == 1 else 'coins'}",
                "coins_redeemed": coins,
                "amount": paise_to_rupees(txn.amount_paise),
                "new_balance": paise_to_rupees(wallet.balance_paise) if wallet else None,
                "txn_id": txn.reference,
                "coins": snapshot(g.user_id),
            }
        ),
        200,
    )
