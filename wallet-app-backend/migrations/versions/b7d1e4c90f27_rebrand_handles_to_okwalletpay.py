"""Rebrand wallet handles to @okwalletpay

Revision ID: b7d1e4c90f27
Revises: ae667c5336f2
Create Date: 2026-10-01 01:05:00.000000

The handle suffix is part of a user's identity, so changing the default in
config only helps accounts created afterwards — every wallet that already exists
would keep advertising the old suffix. This rewrites them in place.

It is a data migration rather than a schema one on purpose: nothing about the
column changes, only the values inside it, and a deploy has to converge an
already-populated database.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b7d1e4c90f27'
down_revision = 'ae667c5336f2'
branch_labels = None
depends_on = None

OLD_SUFFIX = "@demoupi"
NEW_SUFFIX = "@okwalletpay"


def upgrade():
    # `replace` keeps the local part (usually the mobile number) intact, and the
    # WHERE clause makes the statement a no-op on an already-migrated database.
    op.execute(
        f"UPDATE users SET vpa = replace(vpa, '{OLD_SUFFIX}', '{NEW_SUFFIX}') "
        f"WHERE vpa LIKE '%{OLD_SUFFIX}'"
    )


def downgrade():
    op.execute(
        f"UPDATE users SET vpa = replace(vpa, '{NEW_SUFFIX}', '{OLD_SUFFIX}') "
        f"WHERE vpa LIKE '%{NEW_SUFFIX}'"
    )
