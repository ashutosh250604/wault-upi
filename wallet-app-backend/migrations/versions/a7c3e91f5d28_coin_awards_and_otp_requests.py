"""Add the coin award log and the OTP request counter

Revision ID: a7c3e91f5d28
Revises: d4a9c12f7b83
Create Date: 2026-10-07 03:00:00.000000

Two columns' worth of new state, for the same reason: both replace a rule the
app used to derive with something it now has to remember.

`coin_awards` — a payment used to mint a coin every third time, so the balance
was just arithmetic on the ledger. A payout is now a random 1–50 drawn per
payment, and a random amount has no arithmetic to recover it from: the ledger
knows a payment happened, not what it paid. The award is therefore written down
against the transaction that earned it. `transaction_id` is unique, which is
what makes announcing a payment idempotent — a retry cannot pay for the same
transfer twice.

`users.otp_requests` — the resend throttle used to be a flat 60 seconds between
codes. It is now counted instead: the first few requests for a number are free,
and the wait only starts once a run of them has been made. "A run of them" is
state, so it needs a column; it resets when a code is verified.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a7c3e91f5d28'
down_revision = 'd4a9c12f7b83'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'coin_awards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('coins', sa.Integer(), nullable=False),
        sa.Column('transaction_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('transaction_id'),
    )
    op.create_index('ix_coin_awards_user_id', 'coin_awards', ['user_id'], unique=False)

    # Existing rows predate the counter, so they start at zero — which is also
    # the truth: no one has asked for anything under the new rule yet.
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('otp_requests', sa.Integer(), nullable=False, server_default='0')
        )


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('otp_requests')

    op.drop_index('ix_coin_awards_user_id', table_name='coin_awards')
    op.drop_table('coin_awards')
