"""Money requests: asking for money, and answering when someone asks you.

A request is an *ask*, not a payment. Nothing touches a wallet until the person
who was asked approves it with their PIN, and the resulting transfer is recorded
in the same commit that closes the request — so there is never a state where the
money moved but the ask still looks open.
"""

from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import or_

from ..directory import classify_identifier, find_payee
from ..events import notify
from ..extensions import db
from ..ledger import TransferRefused, settle_transfer
from ..models import Notification, PaymentRequest, User
from ..money import paise_to_rupees, rupees_to_paise
from ..coins import announce_payment as announce_coins
from ..coins import card_for_transaction
from ..rewards import credited_summary, settle_due
from ..security import check_pin, current_user, require_auth
from ..timeutils import as_utc, utcnow

bp = Blueprint("requests", __name__)

MAX_NOTE = 140
DEFAULT_LIST_LIMIT = 50
MAX_LIST_LIMIT = 200


def _find_payer(data) -> tuple[User | None, tuple | None]:
    """Resolve who is being asked, by id or by mobile number / UPI ID."""
    raw_id = data.get("payer_id")
    if raw_id is not None:
        try:
            payer_id = int(raw_id)
        except (TypeError, ValueError):
            return None, (jsonify({"message": "Invalid payer"}), 400)
        payer = db.session.get(User, payer_id)
        if payer is None:
            return None, (jsonify({"message": "No wallet found for this account"}), 404)
        return payer, None

    vpa, mobile = classify_identifier(
        data.get("identifier") or data.get("vpa") or data.get("mobile")
    )
    if not vpa and not mobile:
        return None, (
            jsonify({"message": "Enter a valid UPI ID or 10-digit mobile number"}),
            400,
        )

    payer = find_payee(vpa=vpa, mobile=mobile)
    if payer is None:
        return None, (
            jsonify({"message": "No wallet found for this UPI ID or mobile number"}),
            404,
        )
    return payer, None


def _load(request_id: int) -> tuple[PaymentRequest | None, tuple | None]:
    """Load a request the caller is a party to, or the error to return."""
    payment_request = db.session.get(PaymentRequest, request_id)
    if payment_request is None or g.user_id not in (
        payment_request.requester_id,
        payment_request.payer_id,
    ):
        # Same answer for "doesn't exist" and "not yours": a stranger shouldn't
        # be able to probe which request ids are real.
        return None, (jsonify({"message": "Request not found"}), 404)
    return payment_request, None


@bp.post("/requests")
@require_auth
def create_request():
    data = request.get_json(silent=True) or {}
    requester = current_user()
    if requester is None:
        return jsonify({"message": "User not found"}), 404

    payer, failure = _find_payer(data)
    if failure is not None:
        return failure
    if payer.id == requester.id:
        return jsonify({"message": "You can't ask yourself for money"}), 400
    if not payer.name:
        # A wallet that never finished onboarding has no directory entry, so the
        # payer would never know who is asking.
        return jsonify({"message": "This account hasn't finished setting up"}), 409

    paise, error = rupees_to_paise(data.get("amount"))
    if error:
        return jsonify({"message": error}), 400
    if paise > current_app.config["MAX_TRANSFER_RUPEES"] * 100:
        return (
            jsonify(
                {
                    "message": "You can ask for at most "
                    f"₹{current_app.config['MAX_TRANSFER_RUPEES']:,} in one request"
                }
            ),
            400,
        )

    note = (data.get("note") or "").strip()[:MAX_NOTE] or None

    # Asking the same person for the same amount twice in a row usually means a
    # double tap, not two separate debts — so refresh the open one instead.
    duplicate = PaymentRequest.query.filter_by(
        requester_id=requester.id,
        payer_id=payer.id,
        amount_paise=paise,
        status=PaymentRequest.PENDING,
    ).first()
    if duplicate is not None:
        duplicate.note = note or duplicate.note
        duplicate.updated_at = utcnow()
        db.session.commit()
        payload = duplicate.to_dict(requester.id)
        payload["message"] = f"{payer.name} still has your open request for this amount"
        return jsonify(payload), 200

    payment_request = PaymentRequest(
        requester_id=requester.id,
        payer_id=payer.id,
        amount_paise=paise,
        note=note,
        status=PaymentRequest.PENDING,
    )
    db.session.add(payment_request)
    db.session.flush()
    # The ask is news for the person being asked, so it earns a place in their
    # inbox. Refreshing a duplicate above deliberately does *not* notify again —
    # a double tap must not look like two people asking.
    notify(
        payer.id,
        Notification.REQUEST_RECEIVED,
        f"{requester.name or 'Someone'} asked you for money",
        note or "Open Requests to pay or decline",
        amount_paise=paise,
    )
    db.session.commit()

    payload = payment_request.to_dict(requester.id)
    payload["message"] = (
        f"Asked {payer.name} for ₹{paise_to_rupees(paise):,.2f}"
    )
    return jsonify(payload), 201


@bp.get("/requests")
@require_auth
def list_requests():
    """Everything involving this user: open asks first, then settled ones."""
    limit = request.args.get("limit", default=DEFAULT_LIST_LIMIT, type=int)
    limit = min(max(limit or DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT)

    rows = (
        PaymentRequest.query.filter(
            or_(
                PaymentRequest.requester_id == g.user_id,
                PaymentRequest.payer_id == g.user_id,
            )
        )
        .order_by(PaymentRequest.created_at.desc(), PaymentRequest.id.desc())
        .limit(limit)
        .all()
    )

    open_requests = [row for row in rows if row.status == PaymentRequest.PENDING]
    settled = [row for row in rows if row.status != PaymentRequest.PENDING]
    # An open ask stays at the top however old it is; the rest read newest-first.
    settled.sort(
        key=lambda row: (as_utc(row.resolved_at or row.created_at), row.id), reverse=True
    )

    return jsonify([row.to_dict(g.user_id) for row in (*open_requests, *settled)]), 200


@bp.post("/requests/<int:request_id>/pay")
@require_auth
def pay_request(request_id):
    """Approve an ask: verify the PIN, move the money, close the request."""
    data = request.get_json(silent=True) or {}
    pin = (data.get("pin") or "").strip()

    payment_request, failure = _load(request_id)
    if failure is not None:
        return failure
    if payment_request.payer_id != g.user_id:
        return jsonify({"message": "Only the person who was asked can pay this"}), 403
    if payment_request.status != PaymentRequest.PENDING:
        return (
            jsonify(
                {
                    "message": f"This request was already {payment_request.status}",
                    "request": payment_request.to_dict(g.user_id),
                }
            ),
            409,
        )

    payer = current_user()
    if payer is None:
        return jsonify({"message": "User not found"}), 404
    message, status = check_pin(payer, pin)
    if message:
        return jsonify({"message": message}), status

    try:
        txn = settle_transfer(
            sender_id=payer.id,
            receiver_id=payment_request.requester_id,
            paise=payment_request.amount_paise,
            note=payment_request.note,
        )
    except TransferRefused as refusal:
        return jsonify({"message": refusal.message}), refusal.status

    payment_request.status = PaymentRequest.PAID
    payment_request.transfer_id = txn.id
    payment_request.resolved_at = utcnow()
    # Settle offers for both sides before the single commit below: the payer may
    # have just completed their third payment, and the requester may have just
    # been paid for the first time. Timed at the transfer itself, as in the
    # transfer blueprint — see `settle_due`.
    credited = settle_due(payer.id, txn.timestamp)
    settle_due(payment_request.requester_id, txn.timestamp)
    # Settling a request is a payment, so it counts towards coins exactly as a
    # direct transfer does.
    coins = announce_coins(payer.id, txn.id, txn.timestamp)
    # One commit for the ledger row and the request's new state: they can never
    # disagree about whether the money moved.
    db.session.commit()

    requester = payment_request.requester
    payload = {
        "message": f"₹{paise_to_rupees(payment_request.amount_paise):,.2f} paid to "
        f"{requester.name if requester else 'the requester'}",
        "request": payment_request.to_dict(g.user_id),
        "txn_id": txn.reference,
        "amount": paise_to_rupees(payment_request.amount_paise),
        "from": payer.id,
        "to": payment_request.requester_id,
        "note": payment_request.note,
        "timestamp": as_utc(txn.timestamp).isoformat(),
    }
    if credited:
        payload["rewards"] = credited_summary(credited)
    if coins:
        payload["coins_earned"] = coins
        # Settling a request hands over the same card a direct payment does, so
        # the receipt can scratch it and the collection screen knows it is done.
        card = card_for_transaction(payer.id, txn.id)
        if card is not None:
            payload["coin_card_id"] = card.id
    return jsonify(payload), 200


@bp.post("/requests/<int:request_id>/decline")
@require_auth
def decline_request(request_id):
    payment_request, failure = _load(request_id)
    if failure is not None:
        return failure
    if payment_request.payer_id != g.user_id:
        return jsonify({"message": "Only the person who was asked can decline this"}), 403

    return _settle_without_money(payment_request, PaymentRequest.DECLINED, "Declined")


@bp.post("/requests/<int:request_id>/cancel")
@require_auth
def cancel_request(request_id):
    payment_request, failure = _load(request_id)
    if failure is not None:
        return failure
    if payment_request.requester_id != g.user_id:
        return (
            jsonify({"message": "Only the person who asked can cancel this request"}),
            403,
        )

    return _settle_without_money(payment_request, PaymentRequest.CANCELLED, "Cancelled")


def _settle_without_money(payment_request: PaymentRequest, status: str, label: str):
    """Close a request without moving any money (declined / cancelled)."""
    if payment_request.status != PaymentRequest.PENDING:
        return (
            jsonify(
                {
                    "message": f"This request was already {payment_request.status}",
                    "request": payment_request.to_dict(g.user_id),
                }
            ),
            409,
        )

    payment_request.status = status
    payment_request.resolved_at = utcnow()

    # Whoever didn't press the button gets told. A request that quietly
    # disappears is the thing people complain about in payment apps.
    actor = current_user()
    actor_name = (actor.name if actor else None) or "They"
    other = payment_request.counterparty_for(g.user_id)
    if other is not None:
        notify(
            other.id,
            Notification.REQUEST_DECLINED,
            f"{actor_name} declined your request"
            if status == PaymentRequest.DECLINED
            else f"{actor_name} cancelled their request",
            payment_request.note or "No money moved",
            amount_paise=payment_request.amount_paise,
        )
    db.session.commit()

    payload = payment_request.to_dict(g.user_id)
    payload["message"] = f"{label} — no money moved"
    return jsonify(payload), 200
