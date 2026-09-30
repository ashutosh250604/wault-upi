"""Add money requests

Revision ID: 321125cac3ac
Revises: c60f1a442c74
Create Date: 2026-09-30 23:50:51.301317

Backs "ask someone for money". Kept out of `transactions` on purpose: a request
is an ask, and a declined or forgotten one must never appear in the ledger. The
row is linked to the transfer that settles it, so a paid request can be traced
to the money that moved.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '321125cac3ac'
down_revision = 'c60f1a442c74'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'payment_requests',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('requester_id', sa.Integer(), nullable=False),
        sa.Column('payer_id', sa.Integer(), nullable=False),
        sa.Column('amount_paise', sa.BigInteger(), nullable=False),
        sa.Column('note', sa.String(length=140), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('transfer_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['payer_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['requester_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['transfer_id'], ['transactions.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('payment_requests', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_payment_requests_payer_id'), ['payer_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_payment_requests_requester_id'), ['requester_id'], unique=False)


def downgrade():
    with op.batch_alter_table('payment_requests', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_payment_requests_requester_id'))
        batch_op.drop_index(batch_op.f('ix_payment_requests_payer_id'))

    op.drop_table('payment_requests')
