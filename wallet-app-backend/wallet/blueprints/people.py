"""People: the address book, the home "recent" row, and payee resolution.

Everything here answers one of two questions a UPI app asks constantly:
"who do I pay?" (`/people/recent`, `/contacts`) and "who is this handle?"
(`/payees/resolve`). Moving money still lives in the wallet blueprint.
"""

from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from ..directory import classify_identifier, find_payee
from ..extensions import db
from ..models import Contact, Transaction, User
from ..money import paise_to_rupees
from ..security import require_auth
from ..timeutils import as_utc, utcnow

bp = Blueprint("people", __name__)

# How many recent transfers we scan when ranking people. The demo dataset is
# tiny; the cap just keeps the query bounded as history grows.
RECENT_SCAN_LIMIT = 300
_EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def _clean_nickname(raw) -> str | None:
    """Trim a nickname; None means "no nickname", which is not an error."""
    text = str(raw or "").strip()
    return text[:60] if text else None


def _row(payee: User, contact: Contact | None) -> dict:
    """The shape every people list returns, whoever the payee came from."""
    return {
        "user_id": payee.id,
        "name": payee.name,
        "nickname": contact.nickname if contact else None,
        "vpa": payee.vpa,
        "mobile": payee.mobile,
        "is_saved": contact is not None,
        "is_favourite": bool(contact and contact.is_favourite),
        "txn_count": 0,
        "total": 0.0,
        "last_amount": None,
        "last_direction": None,
        "last_note": None,
        "last_at": None,
    }


def _paid_people(user_id: int) -> list[dict]:
    """Rank everyone this user has transferred money with, most recent first.

    Recency leads and frequency breaks ties: the row under the balance reads as
    "people you deal with", so the person you just paid belongs at its front.
    Derived from the ledger rather than a stored counter, so the row can never
    drift from the transaction history it claims to summarise.
    """
    rows = (
        Transaction.query.filter(Transaction.type == "transfer")
        .filter(or_(Transaction.sender_id == user_id, Transaction.receiver_id == user_id))
        .order_by(Transaction.timestamp.desc(), Transaction.id.desc())
        .limit(RECENT_SCAN_LIMIT)
        .all()
    )

    tally: dict[int, dict] = {}
    for txn in rows:
        outgoing = txn.sender_id == user_id
        other_id = txn.receiver_id if outgoing else txn.sender_id
        if other_id is None or other_id == user_id:
            continue
        entry = tally.get(other_id)
        if entry is None:
            # Rows arrive newest-first, so the first sighting is the last payment.
            entry = {
                "payee_id": other_id,
                "count": 0,
                "total_paise": 0,
                "last_at": txn.timestamp,
                "last_amount_paise": txn.amount_paise,
                "last_direction": "out" if outgoing else "in",
                "last_note": txn.note,
            }
            tally[other_id] = entry
        entry["count"] += 1
        entry["total_paise"] += txn.amount_paise

    ranked = sorted(
        tally.values(),
        key=lambda entry: (as_utc(entry["last_at"]) or _EPOCH, entry["count"]),
        reverse=True,
    )
    if not ranked:
        return []

    ids = [entry["payee_id"] for entry in ranked]
    users = {user.id: user for user in User.query.filter(User.id.in_(ids)).all()}
    saved = {
        contact.payee_id: contact
        for contact in Contact.query.filter(
            Contact.owner_id == user_id, Contact.payee_id.in_(ids)
        ).all()
    }

    payload = []
    for entry in ranked:
        payee = users.get(entry["payee_id"])
        if payee is None:
            continue
        row = _row(payee, saved.get(payee.id))
        row.update(
            txn_count=entry["count"],
            total=paise_to_rupees(entry["total_paise"]),
            last_amount=paise_to_rupees(entry["last_amount_paise"]),
            last_direction=entry["last_direction"],
            last_note=entry["last_note"],
            last_at=as_utc(entry["last_at"]).isoformat() if entry["last_at"] else None,
        )
        payload.append(row)
    return payload


def _saved_people(user_id: int) -> list[dict]:
    """Saved contacts, favourites first, then most recently paid."""
    contacts = Contact.query.filter_by(owner_id=user_id).all()
    contacts.sort(
        key=lambda contact: (
            not contact.is_favourite,
            -(as_utc(contact.last_paid_at) - _EPOCH).total_seconds()
            if contact.last_paid_at
            else 0,
            (as_utc(contact.created_at) - _EPOCH).total_seconds(),
        )
    )

    payload = []
    for contact in contacts:
        if contact.payee is None:
            continue
        row = _row(contact.payee, contact)
        if contact.last_paid_at:
            row["last_at"] = as_utc(contact.last_paid_at).isoformat()
        payload.append(row)
    return payload


@bp.get("/people/recent")
@require_auth
def recent_people():
    """The home screen's avatar row: people paid recently, then saved contacts.

    One merged, ranked list so the client makes a single request and never has
    to decide how history and the address book interleave.
    """
    limit = request.args.get("limit", default=8, type=int) or 8
    limit = min(max(limit, 1), 20)

    merged = _paid_people(g.user_id)
    seen = {row["user_id"] for row in merged}
    for row in _saved_people(g.user_id):
        if row["user_id"] in seen:
            continue
        merged.append(row)
        seen.add(row["user_id"])

    return jsonify(merged[:limit]), 200


@bp.get("/contacts")
@require_auth
def list_contacts():
    contacts = (
        Contact.query.filter_by(owner_id=g.user_id)
        .order_by(Contact.is_favourite.desc(), Contact.created_at.asc())
        .all()
    )
    return jsonify([contact.to_dict() for contact in contacts]), 200


@bp.post("/contacts")
@require_auth
def add_contact():
    """Save a payee, by UPI ID or mobile number.

    Idempotent on purpose: re-saving someone updates the nickname/favourite
    instead of erroring, which is what a "Save contact" button should do.
    """
    data = request.get_json(silent=True) or {}
    vpa, mobile = classify_identifier(
        data.get("identifier") or data.get("vpa") or data.get("mobile")
    )
    if not vpa and not mobile:
        return jsonify({"message": "Enter a valid UPI ID or 10-digit mobile number"}), 400

    payee = find_payee(vpa=vpa, mobile=mobile)
    if payee is None:
        return jsonify({"message": "No wallet found for this UPI ID or mobile number"}), 404
    if payee.id == g.user_id:
        return jsonify({"message": "That's your own account"}), 400

    raw_nickname = data.get("nickname")
    nickname = _clean_nickname(raw_nickname)
    if raw_nickname and len(str(raw_nickname).strip()) > 60:
        return jsonify({"message": "Nickname must be 60 characters or fewer"}), 400

    contact = Contact.query.filter_by(owner_id=g.user_id, payee_id=payee.id).first()
    created = contact is None
    if contact is None:
        contact = Contact(
            owner_id=g.user_id,
            payee_id=payee.id,
            nickname=nickname,
            is_favourite=bool(data.get("is_favourite")),
        )
        db.session.add(contact)
    elif nickname is not None:
        contact.nickname = nickname

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"message": "Could not save this contact"}), 500

    label = contact.nickname or payee.name or contact.payee.vpa
    payload = contact.to_dict()
    payload["message"] = (
        f"{label} saved to your contacts"
        if created
        else f"{label} is already in your contacts"
    )
    return jsonify(payload), 201 if created else 200


@bp.patch("/contacts/<int:contact_id>")
@require_auth
def update_contact(contact_id):
    contact = Contact.query.filter_by(id=contact_id, owner_id=g.user_id).first()
    if contact is None:
        return jsonify({"message": "Contact not found"}), 404

    data = request.get_json(silent=True) or {}
    if "nickname" in data:
        raw_nickname = data.get("nickname")
        if raw_nickname and len(str(raw_nickname).strip()) > 60:
            return jsonify({"message": "Nickname must be 60 characters or fewer"}), 400
        contact.nickname = _clean_nickname(raw_nickname)
    if "is_favourite" in data:
        contact.is_favourite = bool(data.get("is_favourite"))

    contact.updated_at = utcnow()
    db.session.commit()
    return jsonify(contact.to_dict()), 200


@bp.delete("/contacts/<int:contact_id>")
@require_auth
def delete_contact(contact_id):
    contact = Contact.query.filter_by(id=contact_id, owner_id=g.user_id).first()
    if contact is None:
        return jsonify({"message": "Contact not found"}), 404

    db.session.delete(contact)
    db.session.commit()
    return jsonify({"message": "Contact removed"}), 200


@bp.post("/payees/resolve")
@require_auth
def resolve_payee():
    """Turn a typed/scanned UPI ID *or* mobile number into a payable wallet."""
    data = request.get_json(silent=True) or {}
    vpa, mobile = classify_identifier(
        data.get("identifier") or data.get("vpa") or data.get("mobile")
    )
    if not vpa and not mobile:
        return jsonify({"message": "Enter a valid UPI ID or 10-digit mobile number"}), 400

    payee = find_payee(vpa=vpa, mobile=mobile)
    if payee is None:
        return jsonify({"message": "No wallet found for this UPI ID or mobile number"}), 404
    if payee.id == g.user_id:
        return jsonify({"message": "This account belongs to you"}), 400
    if not payee.name:
        # A half-onboarded wallet has no directory entry yet, so the payer would
        # see a blank name. Reject it the same way an unknown handle is rejected.
        return jsonify({"message": "This account hasn't finished setting up"}), 409

    saved = Contact.query.filter_by(owner_id=g.user_id, payee_id=payee.id).first()
    return (
        jsonify(
            {
                "user_id": payee.id,
                "name": payee.name,
                "vpa": payee.vpa,
                "mobile": payee.mobile,
                "nickname": saved.nickname if saved else None,
                "is_saved": saved is not None,
            }
        ),
        200,
    )
