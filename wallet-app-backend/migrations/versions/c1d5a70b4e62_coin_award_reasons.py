"""Coins from offers and a welcome bonus

Revision ID: c1d5a70b4e62
Revises: a7c3e91f5d28
Create Date: 2026-10-07 05:10:00.000000

Coins stop being only a payment's payout, so an award has to say where it came
from. `coin_awards.reason` holds that: "payment" for the draw every payment
makes, "signup" for the one-off welcome bonus, and "offer:<code>" for coins an
offer paid. It is a column rather than something inferred because the three are
genuinely different things — only the payment draw has a transaction behind it,
and the reason is what makes the welcome bonus impossible to grant twice.

`rewards.transaction_id` goes the other way. An offer used to credit cashback
straight into the wallet and remembered the credit here; offers now pay in
coins, and a coin award is its own record of what was paid, so the pointer has
nothing left to point at. Existing rows are dropped with it — the coin awards
those offers would now have written were never created, and there is no honest
value to backfill.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c1d5a70b4e62'
down_revision = 'a7c3e91f5d28'
branch_labels = None
depends_on = None


def upgrade():
    # Existing awards are all payment draws, which is the default the column is
    # given — so the backfill is the same statement as the change.
    with op.batch_alter_table('coin_awards', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('reason', sa.String(length=32), nullable=False, server_default='payment')
        )

    with op.batch_alter_table('rewards', schema=None) as batch_op:
        batch_op.drop_column('transaction_id')


def downgrade():
    with op.batch_alter_table('rewards', schema=None) as batch_op:
        batch_op.add_column(sa.Column('transaction_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            'fk_rewards_transaction_id', 'transactions', ['transaction_id'], ['id']
        )

    with op.batch_alter_table('coin_awards', schema=None) as batch_op:
        batch_op.drop_column('reason')
