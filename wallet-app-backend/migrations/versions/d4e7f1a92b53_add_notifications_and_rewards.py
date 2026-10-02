"""Add the notification inbox and the rewards ledger

Revision ID: d4e7f1a92b53
Revises: b7d1e4c90f27
Create Date: 2026-10-01 01:40:00.000000

Two tables that make the wallet tell the truth about itself.

`notifications` is a projection of things that already happened — it holds no
money and no state of its own, only a pointer at the ledger row (`transaction_id`)
plus enough text to render an inbox row without a join.

`rewards` holds per-user *progress*, not the offer itself: the catalogue lives in
code (`wallet/rewards.py`), because an offer is a promise with terms, and terms
belong somewhere reviewable rather than in rows anyone can edit.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd4e7f1a92b53'
down_revision = 'b7d1e4c90f27'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=24), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('body', sa.String(length=200), nullable=True),
        sa.Column('amount_paise', sa.BigInteger(), nullable=True),
        sa.Column('reference', sa.String(length=24), nullable=True),
        sa.Column('transaction_id', sa.Integer(), nullable=True),
        sa.Column('is_read', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_notifications_user_id'), ['user_id'], unique=False
        )

    op.create_table(
        'rewards',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(length=40), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('credited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('transaction_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'code', name='uq_rewards_user_code'),
    )
    with op.batch_alter_table('rewards', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_rewards_user_id'), ['user_id'], unique=False)


def downgrade():
    with op.batch_alter_table('rewards', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_rewards_user_id'))
    op.drop_table('rewards')

    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_notifications_user_id'))
    op.drop_table('notifications')
