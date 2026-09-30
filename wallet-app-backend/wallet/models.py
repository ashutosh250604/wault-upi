from .extensions import db
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
