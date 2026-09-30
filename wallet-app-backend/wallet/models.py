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


class Transaction(db.Model):
    __tablename__ = "transactions"

    id = db.Column(db.Integer, primary_key=True)
    reference = db.Column(db.String(24), unique=True, index=True)
    type = db.Column(db.String(16), nullable=False)  # 'topup' | 'transfer'
    status = db.Column(db.String(16), nullable=False, default="success")
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    receiver_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    amount_paise = db.Column(db.BigInteger, nullable=False)
    note = db.Column(db.String(140))
    timestamp = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    sender = db.relationship("User", foreign_keys=[sender_id])
    receiver = db.relationship("User", foreign_keys=[receiver_id])
