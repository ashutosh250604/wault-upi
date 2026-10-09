from .extensions import db
from .money import paise_to_rupees
from .timeutils import as_utc, utcnow


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    mobile = db.Column(db.String(10), unique=True, nullable=False, index=True)
    name = db.Column(db.String(120))
    email = db.Column(db.String(255), unique=True)
    vpa = db.Column(db.String(64), unique=True, index=True)
    is_verified = db.Column(db.Boolean, nullable=False, default=False)

    pin_hash = db.Column(db.String(255))
    pin_attempts = db.Column(db.Integer, nullable=False, default=0)
    pin_locked_until = db.Column(db.DateTime(timezone=True))

    otp_hash = db.Column(db.String(255))
    otp_expiry = db.Column(db.DateTime(timezone=True))
    otp_attempts = db.Column(db.Integer, nullable=False, default=0)
    otp_is_used = db.Column(db.Boolean, nullable=False, default=False)
    last_otp_sent_at = db.Column(db.DateTime(timezone=True))
    # How many codes have been asked for in a row. The first `OTP_FREE_REQUESTS`
    # are free; after that each one waits out `OTP_RESEND_SECONDS`. Reset when a
    # code is verified, or once the previous code has lapsed — see
    # `blueprints/auth.py`, which is the only writer.
    otp_requests = db.Column(db.Integer, nullable=False, default=0)

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    wallet = db.relationship("Wallet", back_populates="user", uselist=False)

    @property
    def has_name(self) -> bool:
        return bool(self.name and self.name.strip())

    def to_public_dict(self):
        return {
            "user_id": self.id,
            "mobile": self.mobile,
            "name": self.name,
            "vpa": self.vpa,
            "is_verified": self.is_verified,
        }


class Wallet(db.Model):
    __tablename__ = "wallets"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), unique=True, nullable=False
    )
    # Money is stored as integer paise to avoid floating point drift.
    balance_paise = db.Column(db.BigInteger, nullable=False, default=0)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    user = db.relationship("User", back_populates="wallet")


class Contact(db.Model):
    """A saved payee — the app's address book.

    The payee's name/mobile/UPI ID are deliberately *not* copied into this
    table: they are read live from `users` on every read, because in UPI the
    directory decides who you are paying, not the payer's device. Only the
    owner's own annotations (nickname, favourite) live here.
    """

    __tablename__ = "contacts"
    __table_args__ = (
        db.UniqueConstraint("owner_id", "payee_id", name="uq_contacts_owner_payee"),
    )

    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    payee_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    # What the owner calls this person; the registered name is still shown under it.
    nickname = db.Column(db.String(60))
    is_favourite = db.Column(db.Boolean, nullable=False, default=False)
    last_paid_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    payee = db.relationship("User", foreign_keys=[payee_id])

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.payee_id,
            "name": self.payee.name if self.payee else None,
            "nickname": self.nickname,
            "vpa": self.payee.vpa if self.payee else None,
            "mobile": self.payee.mobile if self.payee else None,
            "is_favourite": self.is_favourite,
            "last_paid_at": as_utc(self.last_paid_at).isoformat()
            if self.last_paid_at
            else None,
        }


class LinkedAccount(db.Model):
    """A bank account the wallet can top up from.

    Modelled the way a UPI app actually thinks: the app never holds the money,
    it holds a pointer to an account plus a masked number. The balance is kept
    here but only handed out by the PIN-gated endpoint, because that is exactly
    how a real app gates "check balance" — the number exists, but seeing it is
    an authenticated action.
    """

    __tablename__ = "linked_accounts"
    __table_args__ = (
        db.UniqueConstraint(
            "user_id", "bank_name", "account_last4", name="uq_accounts_user_bank_last4"
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    bank_name = db.Column(db.String(80), nullable=False)
    holder_name = db.Column(db.String(120))
    # Only the last four digits are ever stored or shown — as with a real app.
    account_last4 = db.Column(db.String(4), nullable=False)
    ifsc = db.Column(db.String(11))
    nickname = db.Column(db.String(40))
    balance_paise = db.Column(db.BigInteger, nullable=False, default=0)
    is_default = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    @property
    def masked_number(self) -> str:
        return f"•••• {self.account_last4}"

    def to_dict(self, include_balance: bool = False):
        payload = {
            "id": self.id,
            "bank_name": self.bank_name,
            "nickname": self.nickname,
            "holder_name": self.holder_name,
            "masked_number": self.masked_number,
            "account_last4": self.account_last4,
            "ifsc": self.ifsc,
            "is_default": self.is_default,
        }
        if include_balance:
            payload["balance"] = paise_to_rupees(self.balance_paise)
        return payload


class PaymentRequest(db.Model):
    """"Please pay me" — a request for money, not money itself.

    Deliberately separate from `transactions`: nothing has moved yet, and an
    declined or forgotten request must never show up in the ledger. A request
    only becomes a transaction at the moment the payer approves it, and the
    resulting transfer is linked back here.
    """

    __tablename__ = "payment_requests"

    PENDING = "pending"
    PAID = "paid"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    OPEN_STATUSES = (PENDING,)

    id = db.Column(db.Integer, primary_key=True)
    # Who wants the money, and who is being asked for it.
    requester_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    payer_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    amount_paise = db.Column(db.BigInteger, nullable=False)
    note = db.Column(db.String(140))
    status = db.Column(db.String(16), nullable=False, default=PENDING)
    # Set when the request is paid, so the receipt can be traced back both ways.
    transfer_id = db.Column(db.Integer, db.ForeignKey("transactions.id"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )
    resolved_at = db.Column(db.DateTime(timezone=True))

    requester = db.relationship("User", foreign_keys=[requester_id])
    payer = db.relationship("User", foreign_keys=[payer_id])
    transfer = db.relationship("Transaction", foreign_keys=[transfer_id])

    def counterparty_for(self, viewer_id: int) -> User | None:
        """The other side of this request, from `viewer_id`'s point of view."""
        return self.payer if viewer_id == self.requester_id else self.requester

    def to_dict(self, viewer_id: int):
        other = self.counterparty_for(viewer_id)
        return {
            "id": self.id,
            # "incoming" means someone is asking *you* for money.
            "direction": "outgoing" if viewer_id == self.requester_id else "incoming",
            "status": self.status,
            "amount": paise_to_rupees(self.amount_paise),
            "note": self.note,
            "created_at": as_utc(self.created_at).isoformat() if self.created_at else None,
            "resolved_at": as_utc(self.resolved_at).isoformat()
            if self.resolved_at
            else None,
            "counterparty": {
                "user_id": other.id if other else None,
                "name": other.name if other else None,
                "vpa": other.vpa if other else None,
                "mobile": other.mobile if other else None,
            },
            "transfer_reference": self.transfer.reference if self.transfer else None,
        }


class Notification(db.Model):
    """One line in the inbox.

    A projection of something that already happened, never a source of truth:
    the money lives in `transactions`, and this row only points at it
    (`transaction_id`) plus enough text to render without a join. A notification
    is therefore safe to delete — nothing about the wallet changes.
    """

    __tablename__ = "notifications"

    MONEY_RECEIVED = "money_received"
    MONEY_SENT = "money_sent"
    TOPUP = "topup"
    REQUEST_RECEIVED = "request_received"
    # Covers both a decline and a withdrawal: either way an ask the user was
    # party to closed without money moving, and the title says which happened.
    REQUEST_DECLINED = "request_declined"
    REWARD = "reward"
    SECURITY = "security"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    kind = db.Column(db.String(24), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    body = db.Column(db.String(200))
    # Set only for the money-shaped kinds, so the inbox can right-align an amount.
    amount_paise = db.Column(db.BigInteger)
    reference = db.Column(db.String(24))
    transaction_id = db.Column(db.Integer, db.ForeignKey("transactions.id"))
    is_read = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    transaction = db.relationship("Transaction", foreign_keys=[transaction_id])

    def to_dict(self):
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "body": self.body,
            "amount": paise_to_rupees(self.amount_paise)
            if self.amount_paise is not None
            else None,
            "reference": self.reference,
            "is_read": self.is_read,
            "created_at": as_utc(self.created_at).isoformat() if self.created_at else None,
        }


class Reward(db.Model):
    """A user's progress against one offer.

    Only per-user state is stored here — status and dates. The offer itself
    (title, terms, target, payout) lives in `wallet/rewards.py`, so the promise
    the user is being held to has exactly one definition and can't drift from a
    row somebody edited.

    There is deliberately no pointer to a transaction. Offers pay in coins now,
    and a coin award is itself the record of what was paid — the row here only
    has to say that the promise was kept, and `credited_at` says when.
    """

    __tablename__ = "rewards"
    __table_args__ = (
        db.UniqueConstraint("user_id", "code", name="uq_rewards_user_code"),
    )

    ACTIVE = "active"
    CREDITED = "credited"
    EXPIRED = "expired"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    code = db.Column(db.String(40), nullable=False)
    status = db.Column(db.String(16), nullable=False, default=ACTIVE)
    # Progress is counted from here, so an offer activated today never counts
    # payments the user made last week towards a promise made now.
    started_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    expires_at = db.Column(db.DateTime(timezone=True))
    credited_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )


class CoinAward(db.Model):
    """Coins a payment drew, written down the moment it settles.

    A payout is random (1–50, weighted towards the low end — see
    `wallet/coins.py`), and a random amount cannot be re-derived from the
    ledger the way a fixed "every third payment" rule could. So the draw is
    recorded here, against the transaction that earned it, and the balance is
    the sum of these rows.

    `transaction_id` is unique: it is the record of what a payment paid, and
    the guarantee that a retry or a double settle cannot pay for it twice.
    """

    __tablename__ = "coin_awards"

    #: A payment's draw. One row per payment, guarded by `transaction_id`.
    REASON_PAYMENT = "payment"
    #: The one-off welcome bonus, granted once per account and guarded by
    #: `reason` — there is no transaction behind it to be unique on.
    REASON_SIGNUP = "signup"
    #: Coins paid by an offer. The code is kept in the reason
    #: ("offer:three_payments") so an award can always be traced back to the
    #: promise that paid it.
    OFFER_PREFIX = "offer:"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    coins = db.Column(db.Integer, nullable=False)
    # Where the coins came from. Stored rather than inferred: a payment's payout
    # is a random draw that only this row records, and the welcome bonus and an
    # offer's payout have no transaction of their own to be identified by.
    reason = db.Column(db.String(32), nullable=False, default=REASON_PAYMENT)
    transaction_id = db.Column(
        db.Integer, db.ForeignKey("transactions.id"), nullable=True, unique=True
    )
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    transaction = db.relationship("Transaction", foreign_keys=[transaction_id])


class CoinRedemption(db.Model):
    """Coins spent, and the wallet credit they bought.

    The coin *balance* is the award log minus this one (see `wallet/coins.py`),
    so neither needs a running total that could drift. Spending is the thing the
    ledger can't tell us — the credit it buys looks like any other money
    arriving — so this row is both the record of the payout and the guard that
    stops the same coins being spent twice.
    """

    __tablename__ = "coin_redemptions"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    coins = db.Column(db.Integer, nullable=False)
    amount_paise = db.Column(db.BigInteger, nullable=False)
    transaction_id = db.Column(db.Integer, db.ForeignKey("transactions.id"))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    transaction = db.relationship("Transaction", foreign_keys=[transaction_id])


class Transaction(db.Model):
    __tablename__ = "transactions"

    id = db.Column(db.Integer, primary_key=True)
    reference = db.Column(db.String(24), unique=True, index=True)
    # 'topup' | 'transfer' | 'cashback' | 'coins'. A cashback or coin credit has
    # no sender — the money comes from WAULT's own rewards engine, not from
    # another wallet.
    type = db.Column(db.String(16), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="success")
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    receiver_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    amount_paise = db.Column(db.BigInteger, nullable=False)
    note = db.Column(db.String(140))
    timestamp = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    sender = db.relationship("User", foreign_keys=[sender_id])
    receiver = db.relationship("User", foreign_keys=[receiver_id])
