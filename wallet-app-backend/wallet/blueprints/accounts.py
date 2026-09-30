"""Linked bank accounts and account statements.

Two things a UPI app does that a plain wallet doesn't: it pulls money from a
bank account you linked, and it lets you download a statement of everything that
moved. Both live here.
"""

import csv
import io
from datetime import datetime, timezone

from flask import Blueprint, Response, g, jsonify, request
from sqlalchemy import or_

from ..extensions import db
from ..models import LinkedAccount, Transaction, User
from ..money import paise_to_rupees
from ..security import check_pin, current_user, require_auth
from ..timeutils import as_utc, utcnow

bp = Blueprint("accounts", __name__)


def _own_account(account_id: int) -> LinkedAccount | None:
    """Load an account only if it belongs to the caller."""
    account = db.session.get(LinkedAccount, account_id)
    if account is None or account.user_id != g.user_id:
        return None
    return account


@bp.get("/accounts")
@require_auth
def list_accounts():
    """The caller's funding sources. Balances stay out of this response."""
    accounts = (
        LinkedAccount.query.filter_by(user_id=g.user_id)
        .order_by(LinkedAccount.is_default.desc(), LinkedAccount.created_at.asc())
        .all()
    )
    return jsonify([account.to_dict() for account in accounts]), 200


@bp.post("/accounts/<int:account_id>/default")
@require_auth
def set_default_account(account_id):
    account = _own_account(account_id)
    if account is None:
        return jsonify({"message": "Account not found"}), 404

    # Exactly one default per user: clear the rest in the same commit.
    LinkedAccount.query.filter_by(user_id=g.user_id, is_default=True).update(
        {"is_default": False, "updated_at": utcnow()}
    )
    account.is_default = True
    account.updated_at = utcnow()
    db.session.commit()

    return (
        jsonify(
            {
                "message": f"{account.bank_name} is now your default account",
                "account": account.to_dict(),
            }
        ),
        200,
    )


@bp.post("/accounts/<int:account_id>/balance")
@require_auth
def check_balance(account_id):
    """Reveal a linked account's balance — the PIN-gated \"check balance\" flow."""
    data = request.get_json(silent=True) or {}
    account = _own_account(account_id)
    if account is None:
        return jsonify({"message": "Account not found"}), 404

    user = current_user()
    message, status = check_pin(user, (data.get("pin") or "").strip())
    if message:
        return jsonify({"message": message}), status

    return (
        jsonify(
            {
                "account_id": account.id,
                "balance": paise_to_rupees(account.balance_paise),
                "checked_at": as_utc(utcnow()).isoformat(),
            }
        ),
        200,
    )


def _month_range(month: str | None) -> tuple[datetime | None, datetime | None]:
    """Turn "2026-09" into a UTC window, or (None, None) for everything."""
    if not month:
        return None, None
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=timezone.utc)
    except ValueError:
        return None, None
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


@bp.get("/statements.csv")
@require_auth
def statement_csv():
    """The caller's statement as a CSV download, optionally for one month."""
    month = request.args.get("month")
    start, end = _month_range(month)

    query = (
        Transaction.query.filter(
            or_(Transaction.sender_id == g.user_id, Transaction.receiver_id == g.user_id)
        )
        .order_by(Transaction.timestamp.asc(), Transaction.id.asc())
    )
    if start and end:
        query = query.filter(Transaction.timestamp >= start, Transaction.timestamp < end)
    rows = query.all()

    me = db.session.get(User, g.user_id)
    involved = {row.sender_id for row in rows} | {row.receiver_id for row in rows}
    involved.discard(None)
    names = (
        {user.id: user for user in User.query.filter(User.id.in_(involved)).all()}
        if involved
        else {}
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "Date",
            "Time",
            "Reference",
            "Type",
            "Direction",
            "Counterparty",
            "Counterparty UPI ID",
            "Amount (INR)",
            "Status",
            "Note",
        ]
    )
    for row in rows:
        outgoing = row.sender_id == g.user_id
        counterparty = names.get(row.receiver_id if outgoing else row.sender_id)
        when = as_utc(row.timestamp)
        writer.writerow(
            [
                when.strftime("%Y-%m-%d"),
                when.strftime("%H:%M:%S"),
                row.reference,
                "Top-up" if row.type == "topup" else "Payment",
                "Debit" if outgoing else "Credit",
                counterparty.name if counterparty else ("Self" if row.type == "topup" else ""),
                counterparty.vpa if counterparty else "",
                f"{'-' if outgoing else ''}{paise_to_rupees(row.amount_paise):.2f}",
                row.status.capitalize(),
                row.note or "",
            ]
        )

    # A minute-level timestamp keeps repeat downloads from overwriting each other.
    stamp = as_utc(utcnow()).strftime("%Y%m%d-%H%M")
    label = (me.vpa or f"user{me.id}").split("@")[0]
    filename = f"pocketpay-statement-{label}-{stamp}.csv"

    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Lets the SPA read the filename it should save the blob under.
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )
