"""Linked bank accounts and account statements.

Two things a UPI app does that a plain wallet doesn't: it pulls money from a
bank account you linked, and it lets you download a statement of everything that
moved. Both live here.
"""

import csv
import io
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, g, jsonify, request
from sqlalchemy import or_

from ..extensions import db
from ..models import LinkedAccount, Transaction, User, Wallet
from ..money import paise_to_rupees
from ..security import check_pin, current_user, require_auth
from ..timeutils import IST, as_utc, format_date, to_ist, utcnow

bp = Blueprint("accounts", __name__)

# How each ledger row reads in a downloaded statement. Shared with the PDF
# builder, which is imported lazily so reportlab stays out of app startup.
TYPE_LABELS = {
    "topup": "Top-up",
    "transfer": "Payment",
    "cashback": "Cashback",
    "coins": "Coin reward",
}
SELF_LABELS = {"topup": "Self", "cashback": "WAULT rewards", "coins": "WAULT coins"}


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
    if user is None:
        return jsonify({"message": "User not found"}), 404
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


def _month_range(month: str | None) -> tuple[datetime | None, datetime | None, str]:
    """Turn "2026-09" into a UTC window — the month as the user's calendar sees it.

    The boundaries are built at IST midnight and only then converted, so a
    payment made at 1am on the 1st lands in that month instead of in the previous
    one on the server's clock. Returns the window and how the month reads.
    """
    if not month:
        return None, None, ""
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=IST)
    except ValueError:
        return None, None, ""
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return (
        start.astimezone(timezone.utc),
        end.astimezone(timezone.utc),
        start.strftime("%B %Y"),
    )


def _parse_day(value: str | None) -> datetime | None:
    """"2026-09-01" as IST midnight, in UTC, or None when it isn't a date."""
    if not value:
        return None
    try:
        start = datetime.strptime(value, "%Y-%m-%d").replace(tzinfo=IST)
    except ValueError:
        return None
    return start.astimezone(timezone.utc)


def _day_label(when: datetime) -> str:
    """DD-MM-YYYY, in IST."""
    return format_date(when)


def _statement_window(args) -> tuple[datetime | None, datetime | None, str]:
    """Which slice of the ledger a download covers, and how the period reads.

    `?month=2026-09` is one calendar month; `?from=&to=` is the inclusive pair
    of days the app's period picker sends. Anything missing or unparseable means
    the whole statement, never an error — a download should not fail because a
    date was mistyped.
    """
    start, end, month_label = _month_range(args.get("month"))
    if start and end:
        return start, end, month_label

    first = _parse_day(args.get("from"))
    last = _parse_day(args.get("to"))
    if first and last:
        if first > last:
            # A reversed range is a client mistake, not a request for a slice.
            return None, None, "All transactions"
        # `to` is a calendar day, so the window runs to the end of it.
        return first, last + timedelta(days=1), f"{_day_label(first)} to {_day_label(last)}"
    if first:
        return first, None, f"From {_day_label(first)}"
    if last:
        return None, last + timedelta(days=1), f"Up to {_day_label(last)}"
    return None, None, "All transactions"


def _statement_rows(
    user_id: int, start: datetime | None, end: datetime | None
) -> tuple[list[Transaction], dict[int, User]]:
    """The caller's ledger rows in the window, plus the names they mention."""
    query = (
        Transaction.query.filter(
            or_(Transaction.sender_id == user_id, Transaction.receiver_id == user_id)
        )
        .order_by(Transaction.timestamp.asc(), Transaction.id.asc())
    )
    if start is not None:
        query = query.filter(Transaction.timestamp >= start)
    if end is not None:
        query = query.filter(Transaction.timestamp < end)
    rows = query.all()

    involved = {row.sender_id for row in rows} | {row.receiver_id for row in rows}
    involved.discard(None)
    names = (
        {user.id: user for user in User.query.filter(User.id.in_(involved)).all()}
        if involved
        else {}
    )
    return rows, names


def _movement_after(user_id: int, end: datetime | None) -> int:
    """Signed paise that moved after the period, or 0 when it runs to now.

    This is what makes the statement's closing balance honest for a window that
    ends in the past: the app only knows the balance *today*, so the balance at
    the end of the period is today's figure with everything after the period
    backed out. Signed from the account holder's side, exactly as the rows are.
    """
    if end is None:
        return 0

    rows = (
        db.session.query(Transaction.sender_id, Transaction.amount_paise)
        .filter(
            or_(Transaction.sender_id == user_id, Transaction.receiver_id == user_id),
            Transaction.timestamp >= end,
        )
        .all()
    )
    return sum(
        -row.amount_paise if row.sender_id == user_id else row.amount_paise
        for row in rows
    )


def _statement_filename(me: User, extension: str) -> str:
    """okwault-statement-aarav-20261004-2112.pdf

    A minute-level timestamp keeps repeat downloads from overwriting each other.
    The stamp is IST like every other time the app shows, so a download at 2am is
    filed under the date the user is actually living in.
    """
    label = (me.vpa or f"user{me.id}").split("@")[0]
    stamp = to_ist(utcnow()).strftime("%Y%m%d-%H%M")
    return f"okwault-statement-{label}-{stamp}.{extension}"


@bp.get("/statements.csv")
@require_auth
def statement_csv():
    """The caller's statement as a CSV download, optionally for one period."""
    start, end, _ = _statement_window(request.args)
    rows, names = _statement_rows(g.user_id, start, end)
    me = db.session.get(User, g.user_id)
    if me is None:
        return jsonify({"message": "User not found"}), 404

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
        when = to_ist(row.timestamp)
        writer.writerow(
            [
                when.strftime("%d-%m-%Y"),
                when.strftime("%H:%M:%S"),
                row.reference,
                TYPE_LABELS.get(row.type, "Payment"),
                "Debit" if outgoing else "Credit",
                counterparty.name
                if counterparty
                else SELF_LABELS.get(row.type, ""),
                counterparty.vpa if counterparty else "",
                f"{'-' if outgoing else ''}{paise_to_rupees(row.amount_paise):.2f}",
                row.status.capitalize(),
                row.note or "",
            ]
        )

    return Response(
        buffer.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{_statement_filename(me, "csv")}"',
            # Lets the SPA read the filename it should save the blob under.
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@bp.get("/statements.pdf")
@require_auth
def statement_pdf():
    """The caller's statement as a branded PDF, optionally narrowed to a period."""
    # Imported here, not at module scope: reportlab is the app's heaviest
    # dependency and only this one endpoint needs it.
    from ..statement import build_statement_pdf

    start, end, period_label = _statement_window(request.args)
    rows, names = _statement_rows(g.user_id, start, end)
    me = db.session.get(User, g.user_id)
    if me is None:
        return jsonify({"message": "User not found"}), 404
    wallet = Wallet.query.filter_by(user_id=g.user_id).first()

    pdf = build_statement_pdf(
        holder_name=me.name or "WAULT user",
        holder_vpa=me.vpa or "",
        viewer_id=g.user_id,
        rows=rows,
        counterparties=names,
        period_label=period_label,
        generated_at=as_utc(utcnow()),
        type_labels=TYPE_LABELS,
        self_labels=SELF_LABELS,
        wallet_balance_paise=wallet.balance_paise if wallet is not None else 0,
        movement_after_paise=_movement_after(g.user_id, end),
    )

    return Response(
        pdf,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{_statement_filename(me, "pdf")}"',
            # Lets the SPA read the filename it should save the blob under.
            "Access-Control-Expose-Headers": "Content-Disposition",
            # A statement is scoped to one session's ledger — never cached.
            "Cache-Control": "no-store",
        },
    )
