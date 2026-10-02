"""Seed data for the public demo: accounts, an address book and some history.

Idempotent by design — every deploy runs this, so it may only create what is
missing. History is only written when the ledger is completely empty, so a
production-ish database is never re-seeded underneath its owner.
"""

from datetime import timedelta

from flask import current_app

from .events import notify
from .extensions import db
from .models import Contact, LinkedAccount, Notification, Transaction, User, Wallet
from .money import make_reference
from .rewards import ensure_rewards
from .security import hash_secret
from .timeutils import utcnow

# The first two are the documented demo pair; the rest exist so the "Send money
# to" row, the contacts screen and the frequent-payer ranking aren't empty on a
# fresh install. Anyone here can be signed into with the demo OTP.
DEMO_USERS = [
    {
        "mobile": "9000000001",
        "name": "Aarav Sharma",
        "email": "aarav@walletpay.app",
        "pin": "1234",
        "balance_paise": 500000,  # ₹5,000
    },
    {
        "mobile": "9000000002",
        "name": "Meera Iyer",
        "email": "meera@walletpay.app",
        "pin": "1234",
        "balance_paise": 250000,  # ₹2,500
    },
    {
        "mobile": "9000000004",
        "name": "Rohan Verma",
        "email": "rohan@walletpay.app",
        "pin": "1234",
        "balance_paise": 180000,  # ₹1,800
    },
    {
        "mobile": "9000000005",
        "name": "Ananya Desai",
        "email": "ananya@walletpay.app",
        "pin": "1234",
        "balance_paise": 95000,  # ₹950
    },
    {
        "mobile": "9000000006",
        "name": "Gupta Kirana Store",
        "email": "kirana@walletpay.app",
        "pin": "1234",
        "balance_paise": 420000,  # ₹4,200
    },
]

# (owner mobile, payee mobile, nickname, favourite)
DEMO_CONTACTS = [
    ("9000000001", "9000000002", None, True),
    ("9000000001", "9000000004", None, True),
    ("9000000001", "9000000005", None, False),
    ("9000000001", "9000000006", "Kirana uncle", False),
    ("9000000002", "9000000001", None, True),
]


def seed_demo():
    """Idempotently create the demo accounts, wallets, contacts and history."""
    suffix = current_app.config["VPA_SUFFIX"]
    created = {}

    for spec in DEMO_USERS:
        user = User.query.filter_by(mobile=spec["mobile"]).first()
        if user is None:
            user = User(
                mobile=spec["mobile"],
                name=spec["name"],
                email=spec["email"],
                vpa=f"{spec['mobile']}@{suffix}",
                is_verified=True,
                pin_hash=hash_secret(spec["pin"]),
            )
            db.session.add(user)
            db.session.flush()
            created[spec["mobile"]] = (user, spec["balance_paise"] > 0)
        if user.wallet is None:
            user.wallet = Wallet(user_id=user.id, balance_paise=spec["balance_paise"])
        elif spec["mobile"] in created:
            user.wallet.balance_paise = spec["balance_paise"]

    db.session.commit()
    _seed_history()
    _seed_contacts()
    _seed_accounts()
    _seed_notifications()
    _seed_rewards()


def _seed_history():
    """Add a few backdated transactions so the history screen looks alive."""
    if Transaction.query.count() > 0:
        return

    people = {spec["mobile"]: User.query.filter_by(mobile=spec["mobile"]).first()
              for spec in DEMO_USERS}
    if any(user is None for user in people.values()):
        return

    aarav = people["9000000001"]
    meera = people["9000000002"]
    rohan = people["9000000004"]
    ananya = people["9000000005"]
    kirana = people["9000000006"]

    now = utcnow()
    history = [
        # (days ago, (hour, minute) UTC, type, sender, receiver, rupees, note)
        (14, (10, 24), "topup", None, aarav.id, 3000, None),
        (12, (19, 5), "topup", None, meera.id, 2500, None),
        (9, (18, 40), "topup", None, rohan.id, 1800, None),
        (7, (13, 42), "transfer", aarav.id, meera.id, 250, "Groceries"),
        (6, (20, 15), "topup", None, kirana.id, 4200, None),
        (5, (17, 30), "transfer", aarav.id, rohan.id, 320, "Dinner split"),
        (4, (11, 12), "transfer", ananya.id, aarav.id, 150, "Movie tickets"),
        (3, (9, 15), "topup", None, aarav.id, 2500, None),
        (3, (19, 55), "transfer", aarav.id, kirana.id, 480, "Monthly groceries"),
        (2, (21, 8), "transfer", meera.id, aarav.id, 100, "Cab fare"),
        (1, (8, 50), "transfer", aarav.id, meera.id, 400, "Concert tickets"),
    ]
    for days_ago, (hour, minute), kind, sender_id, receiver_id, rupees, note in history:
        # Vary the clock time too, so the history doesn't read as generated at once.
        when = (now - timedelta(days=days_ago)).replace(
            hour=hour, minute=minute, second=0, microsecond=0
        )
        db.session.add(
            Transaction(
                reference=make_reference(when),
                type=kind,
                sender_id=sender_id,
                receiver_id=receiver_id,
                amount_paise=rupees * 100,
                note=note,
                timestamp=when,
            )
        )
    db.session.commit()


# (mobile, bank, holder, last4, ifsc, nickname, balance paise, default)
DEMO_ACCOUNTS = [
    ("9000000001", "State Bank of India", "Aarav Sharma", "4821", "SBIN0001234", "Salary", 4825000, True),
    ("9000000001", "HDFC Bank", "Aarav Sharma", "9077", "HDFC0000456", "Savings", 1124000, False),
    ("9000000002", "ICICI Bank", "Meera Iyer", "3312", "ICIC0000789", None, 2150000, True),
    ("9000000004", "Axis Bank", "Rohan Verma", "6640", "UTIB0000321", None, 780000, True),
    ("9000000005", "Kotak Mahindra Bank", "Ananya Desai", "1198", "KKBK0000654", None, 430000, True),
    ("9000000006", "Bank of Baroda", "Gupta Kirana Store", "7755", "BARB0KIRANA", "Current", 9600000, True),
]


def _seed_accounts():
    """Link a couple of bank accounts per demo user, so top-ups have a source."""
    if LinkedAccount.query.count() > 0:
        return

    for mobile, bank, holder, last4, ifsc, nickname, paise, is_default in DEMO_ACCOUNTS:
        user = User.query.filter_by(mobile=mobile).first()
        if user is None:
            continue
        if LinkedAccount.query.filter_by(
            user_id=user.id, bank_name=bank, account_last4=last4
        ).first():
            continue
        db.session.add(
            LinkedAccount(
                user_id=user.id,
                bank_name=bank,
                holder_name=holder,
                account_last4=last4,
                ifsc=ifsc,
                nickname=nickname,
                balance_paise=paise,
                is_default=is_default,
            )
        )
    db.session.commit()


def _seed_notifications():
    """Turn the seeded ledger into an inbox, so the bell has history on day one.

    Derived from real transactions rather than hand-written rows: the inbox then
    cannot claim something the ledger doesn't show, and a change to the seeder
    flows into both for free.
    """
    if Notification.query.count() > 0:
        return

    people = {user.id: user for user in User.query.all()}
    rows = (
        Transaction.query.order_by(Transaction.timestamp.asc(), Transaction.id.asc())
        .limit(50)
        .all()
    )

    for txn in rows:
        if txn.type == "topup":
            notify(
                txn.receiver_id,
                Notification.TOPUP,
                "Money added to your wallet",
                "From a linked account",
                transaction=txn,
                when=txn.timestamp,
            )
            continue

        sender = people.get(txn.sender_id)
        receiver = people.get(txn.receiver_id)
        notify(
            txn.receiver_id,
            Notification.MONEY_RECEIVED,
            f"Money received from {sender.name if sender else 'another account'}",
            txn.note or "Tap to see the reference",
            transaction=txn,
            when=txn.timestamp,
        )
        notify(
            txn.sender_id,
            Notification.MONEY_SENT,
            f"Money sent to {receiver.name if receiver else 'another account'}",
            txn.note or "Tap to see the reference",
            transaction=txn,
            when=txn.timestamp,
        )
    db.session.commit()

    # A fresh install shouldn't look like it ignored a fortnight of alerts, so
    # everything backfilled counts as read — except the two most recent, which
    # give the bell a real badge to point at.
    Notification.query.update({"is_read": True})
    db.session.flush()

    showcase = User.query.filter_by(mobile=DEMO_USERS[0]["mobile"]).first()
    if showcase is not None:
        recent = (
            Notification.query.filter_by(user_id=showcase.id)
            .order_by(Notification.created_at.desc(), Notification.id.desc())
            .limit(2)
            .all()
        )
        for note in recent:
            note.is_read = False
    db.session.commit()


def _seed_rewards():
    """Activate the offers for every seeded account.

    Starting the clock now, not at sign-up, is the honest choice: the offers are
    promises about payments made *after* they are taken up, so the demo account
    starts at 0 of 3 rather than pretending last week's history earned it.
    """
    for spec in DEMO_USERS:
        user = User.query.filter_by(mobile=spec["mobile"]).first()
        if user is not None:
            ensure_rewards(user.id)
    db.session.commit()


def _seed_contacts():
    """Give the demo accounts an address book, so people screens have content."""
    if Contact.query.count() > 0:
        return

    for owner_mobile, payee_mobile, nickname, favourite in DEMO_CONTACTS:
        owner = User.query.filter_by(mobile=owner_mobile).first()
        payee = User.query.filter_by(mobile=payee_mobile).first()
        if owner is None or payee is None:
            continue
        if Contact.query.filter_by(owner_id=owner.id, payee_id=payee.id).first():
            continue
        # Stamp the ones we already "paid" in the seeded ledger, so recent-first
        # ordering on the contacts screen has something real to sort by.
        last_paid = (
            Transaction.query.filter_by(sender_id=owner.id, receiver_id=payee.id)
            .order_by(Transaction.timestamp.desc())
            .first()
        )
        db.session.add(
            Contact(
                owner_id=owner.id,
                payee_id=payee.id,
                nickname=nickname,
                is_favourite=favourite,
                last_paid_at=last_paid.timestamp if last_paid else None,
            )
        )
    db.session.commit()
