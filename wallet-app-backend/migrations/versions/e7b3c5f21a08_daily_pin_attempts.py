"""Count wrong PINs per IST day

Revision ID: e7b3c5f21a08
Revises: d2a7b15c9e60
Create Date: 2026-10-10 11:20:00.000000

Wrong PINs are meant to be five a day: the five-then-lock rule protects the
wallet, and a counter that never clears punishes someone who mistyped a digit
last Tuesday. `pin_attempts` alone could not express that — it has no idea which
day it was counting — so `users.pin_attempts_date` records the IST day the count
belongs to, and `check_pin` starts the count over when the day it sees is not the
day it wrote.

The column is nullable and stays null on existing rows: a count with no date is a
count from before this rule, and the next PIN check stamps today's date on it
rather than carrying it forward.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e7b3c5f21a08'
down_revision = 'd2a7b15c9e60'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('pin_attempts_date', sa.Date(), nullable=True))


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('pin_attempts_date')
