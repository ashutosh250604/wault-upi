from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import or_, update
from sqlalchemy.orm import aliased

from ..directory import classify_identifier, find_payee
from ..events import notify
from ..extensions import db
from ..ledger import TransferRefused, credit_wallet, settle_transfer
from ..limits import snapshot
from ..models import LinkedAccount, Notification, Transaction, User, Wallet
from ..money import paise_to_rupees, rupees_to_paise
from ..rewards import credited_summary, settle_due
from ..security import check_pin, current_user, require_auth
from ..timeutils import as_utc, utcnow

bp = Blueprint("wallet", __name__)


@bp.get("/get_balance/<int:user_id>")
@require_auth
def get_balance(user_id):
    if user_id != g.user_id:
        return jsonify({"message": "You can only view your own wallet"}), 403

    wallet = Wallet.query.filter_by(user_id=user_id).first()
    if wallet is None:
        return jsonify({"message": "Wallet not found!"}), 404
    return jsonify({"user_id": user_id, "balance": paise_to_rupees(wallet.balance_paise)}), 200


@bp.post("/topup")
@require_auth
def topup():
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id") or g.user_id
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return jsonify({"message": "Invalid user id"}), 400
    if user_id != g.user_id:
        return jsonify({"message": "You can only top up your own wallet"}), 403

    paise, error = rupees_to_paise(data.get("amount"))
    if error:
        return jsonify({"message": error}), 400
    if paise > current_app.config["MAX_TOPUP_RUPEES"] * 100:
        return jsonify(
            {"message": f"Top-up limit is ₹{current_app.config['MAX_TOPUP_RUPEES']:,}"}
        ), 400

    # Adding money moves money, so it needs the same server-side PIN check as a
    # payment — a top-up is the easiest possible way to launder a stolen token.
    user = current_user()
    if user is None:
        return jsonify({"message": "User not found"}), 404
    message, status = check_pin(user, (data.get("pin") or "").strip())
    if message:
        return jsonify({"message": message}), status

    # Optional funding source: when given, the linked account is debited in the
    # same commit that credits the wallet, so the two can't disagree.
    account_id = data.get("account_id")
    account = None
    if account_id is not None:
        try:
            account_id = int(account_id)
        except (TypeError, ValueError):
            return jsonify({"message": "Invalid account"}), 400
        account = db.session.get(LinkedAccount, account_id)
        if account is None or account.user_id != g.user_id:
            return jsonify({"message": "Account not found"}), 404

        debited = db.session.execute(
            update(LinkedAccount)
            .where(
                LinkedAccount.id == account.id,
                LinkedAccount.balance_paise >= paise,
            )
            .values(balance_paise=LinkedAccount.balance_paise - paise, updated_at=utcnow())
        )
        if debited.rowcount == 0:
            db.session.rollback()
            return (
                jsonify({"message": f"{account.bank_name} doesn't have that much to spare"}),
                400,
            )

    try:
        txn = credit_wallet(user_id, paise, txn_type="topup")
    except TransferRefused as refusal:
        return jsonify({"message": refusal.message}), refusal.status

    notify(
        user_id,
        Notification.TOPUP,
        "Money added to your wallet",
        f"From {account.bank_name} {account.masked_number}"
        if account is not None
        else "From a linked source",
        transaction=txn,
    )
    # A top-up can be the very event that completes an offer, so the cashback is
    # credited in the same commit as the money that earned it rather than in a
    # later, best-effort sweep.
    credited = settle_due(user_id)
    db.session.commit()

    wallet = Wallet.query.filter_by(user_id=user_id).first()
    payload = {
        "message": "Wallet topped up successfully!",
        "new_balance": paise_to_rupees(wallet.balance_paise),
        "user_id": user_id,
        "txn_id": txn.reference,
    }
    if credited:
        payload["rewards"] = credited_summary(credited)
    if account is not None:
        payload["account"] = account.to_dict(include_balance=True)
    return jsonify(payload), 200


@bp.post("/transfer")
@require_auth
def transfer():
    data = request.get_json(silent=True) or {}
    sender_id = g.user_id
    pin = (data.get("pin") or "").strip()
    note = (data.get("note") or "").strip()[:140] or None

    try:
        receiver_id = int(data.get("receiver_id"))
    except (TypeError, ValueError):
        return jsonify({"message": "Receiver is required"}), 400
    if receiver_id == sender_id:
        return jsonify({"message": "Sender and receiver cannot be the same!"}), 400

    paise, error = rupees_to_paise(data.get("amount"))
    if error:
        return jsonify({"message": error}), 400

    # The PIN is verified here, not just on the PIN screen. Otherwise a stolen
    # token would be enough to move money, and the attempt counter could be
    # skipped entirely by calling this endpoint directly.
    sender = current_user()
    if sender is None:
        return jsonify({"message": "User not found"}), 404
    message, status = check_pin(sender, pin)
    if message:
        return jsonify({"message": message}), status

    try:
        txn = settle_transfer(sender_id, receiver_id, paise, note=note)
    except TransferRefused as refusal:
        return jsonify({"message": refusal.message}), refusal.status

    # Settle the payer's offers (this transfer may be their third), then the
    # payee's: being paid for the first time is an offer of its own. Only the
    # payer's are reported back, because only the payer is reading this response.
    credited = settle_due(sender_id)
    settle_due(receiver_id)
    db.session.commit()

    payload = {
        "message": "Transfer successful!",
        "from": sender_id,
        "to": receiver_id,
        "amount": paise_to_rupees(paise),
        "txn_id": txn.reference,
        "note": note,
    }
    if credited:
        payload["rewards"] = credited_summary(credited)
    return jsonify(payload), 200


@bp.get("/limits")
@require_auth
def daily_limits():
    """What is left of today's cap — the same numbers the ledger enforces.

    Deliberately not a client-side calculation: the amount screen and the debit
    itself read this one function, so a limit that is shown can't differ from
    the limit that is applied.
    """
    return jsonify(snapshot(g.user_id)), 200


@bp.post("/vpas/resolve")
@require_auth
def resolve_vpa():
    """Turn a scanned/typed UPI ID into a wallet the user can pay.

    Kept as the narrow, UPI-ID-only entry point (the scanner still uses it);
    /payees/resolve in the people blueprint handles UPI IDs *and* mobiles.
    """
    data = request.get_json(silent=True) or {}
    vpa, _ = classify_identifier(data.get("vpa") or data.get("identifier"))
    if not vpa:
        return jsonify({"message": "Invalid UPI ID"}), 400

    user = find_payee(vpa=vpa)
    if user is None:
        return jsonify({"message": "No wallet found for this UPI ID"}), 404
    if user.id == g.user_id:
        return jsonify({"message": "This UPI ID belongs to you"}), 400

    return jsonify({"user_id": user.id, "name": user.name, "vpa": user.vpa}), 200


@bp.get("/transactions/<int:user_id>")
@require_auth
def transactions(user_id):
    if user_id != g.user_id:
        return jsonify({"message": "You can only view your own transactions"}), 403

    sender_alias = aliased(User)
    receiver_alias = aliased(User)
    rows = (
        db.session.query(
            Transaction,
            sender_alias.name.label("sender_name"),
            receiver_alias.name.label("receiver_name"),
        )
        .outerjoin(sender_alias, Transaction.sender_id == sender_alias.id)
        .outerjoin(receiver_alias, Transaction.receiver_id == receiver_alias.id)
        .filter(
            or_(
                Transaction.sender_id == user_id,
                Transaction.receiver_id == user_id,
            )
        )
        .order_by(Transaction.timestamp.desc(), Transaction.id.desc())
        .all()
    )

    payload = []
    for txn, sender_name, receiver_name in rows:
        payload.append(
            {
                "id": txn.id,
                "reference": txn.reference,
                "type": txn.type,
                "status": txn.status,
                "sender": txn.sender_id,
                "receiver": txn.receiver_id,
                "sender_name": sender_name,
                "receiver_name": receiver_name,
                "amount": paise_to_rupees(txn.amount_paise),
                "note": txn.note,
                "timestamp": as_utc(txn.timestamp).isoformat(),
            }
        )
    return jsonify(payload), 200
