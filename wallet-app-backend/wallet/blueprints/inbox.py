"""The inbox: what the wallet has to say, and what it still owes you.

Two closely related things live here because they are read together — the bell
and the offers strip sit on the same screen.

Notifications are a log of things that already happened and can be deleted
freely; rewards are a promise about things that haven't happened yet and are
settled by the payment paths, not by this screen.
"""

from flask import Blueprint, g, jsonify, request

from ..extensions import db
from ..models import Notification
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
