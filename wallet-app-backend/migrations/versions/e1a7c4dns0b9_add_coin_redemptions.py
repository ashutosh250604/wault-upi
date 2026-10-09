"""Add the coin redemption log

Revision ID: e1a7c4dns0b9
Revises: d4e7f1a92b53
Create Date: 2026-10-06 01:05:00.000000

One table, and only because coins are counted rather than kept.

Everything a user has *earned* is derived from the ledger: a successful
outgoing transfer is a payment, and every third one mints a coin, so the tally
needs no storage and cannot drift from the history the app shows. Spending is
the exception — a coin redemption lands in the wallet as an ordinary credit,
which looks exactly like any other money arriving — so the redemption has to be
written down. This row is therefore both the record of the payout and the guard
that stops the same coins being spent twice.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e1a7c4dns0b9'
down_revision = 'd4e7f1a92b53'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'coin_redemptions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('coins', sa.Integer(), nullable=False),
        sa.Column('amount_paise', sa.BigInteger(), nullable=False),
        sa.Column('transaction_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('coin_redemptions', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_coin_redemptions_user_id'), ['user_id'], unique=False
        )


def downgrade():
    with op.batch_alter_table('coin_redemptions', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_coin_redemptions_user_id'))
    op.drop_table('coin_redemptions')
