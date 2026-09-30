"""Add linked bank accounts

Revision ID: ae667c5336f2
Revises: 321125cac3ac
Create Date: 2026-10-01 00:26:11.402881

Funding sources for top-ups. Only the last four digits are stored — a real UPI
app never holds the full account number, and neither does this one.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'ae667c5336f2'
down_revision = '321125cac3ac'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'linked_accounts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('bank_name', sa.String(length=80), nullable=False),
        sa.Column('holder_name', sa.String(length=120), nullable=True),
        sa.Column('account_last4', sa.String(length=4), nullable=False),
        sa.Column('ifsc', sa.String(length=11), nullable=True),
        sa.Column('nickname', sa.String(length=40), nullable=True),
        sa.Column('balance_paise', sa.BigInteger(), nullable=False),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'bank_name', 'account_last4', name='uq_accounts_user_bank_last4'
        ),
    )
    with op.batch_alter_table('linked_accounts', schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f('ix_linked_accounts_user_id'), ['user_id'], unique=False
        )


def downgrade():
    with op.batch_alter_table('linked_accounts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_linked_accounts_user_id'))

    op.drop_table('linked_accounts')
