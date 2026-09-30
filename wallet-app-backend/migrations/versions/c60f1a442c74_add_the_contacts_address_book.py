"""Add the contacts address book

Revision ID: c60f1a442c74
Revises: 4db0a6150dca
Create Date: 2026-09-30 22:58:42.683613

Backs the "Send money to" row and the contacts screen. Names are intentionally
not denormalised onto this table: a payee's registered name is read live from
`users`, so an address book entry can never hold a stale or edited identity.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c60f1a442c74'
down_revision = '4db0a6150dca'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'contacts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('payee_id', sa.Integer(), nullable=False),
        sa.Column('nickname', sa.String(length=60), nullable=True),
        sa.Column('is_favourite', sa.Boolean(), nullable=False),
        sa.Column('last_paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['payee_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('owner_id', 'payee_id', name='uq_contacts_owner_payee'),
    )
    with op.batch_alter_table('contacts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_contacts_owner_id'), ['owner_id'], unique=False)


def downgrade():
    with op.batch_alter_table('contacts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_contacts_owner_id'))

    op.drop_table('contacts')
