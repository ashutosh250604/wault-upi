"""Rebrand wallet handles to @okwault

Revision ID: d4a9c12f7b83
Revises: c3f8b2a01d47
Create Date: 2026-10-06 21:40:00.000000

The product took its final name, so the handle suffix follows it: `@okvault`
becomes `@okwault`, exactly as `c3f8b2a01d47` moved `@okwalletpay` to `@okvault`
before it. A handle is part of a user's identity, so changing the default in
config only helps accounts created afterwards — every wallet that already exists
would keep advertising the old suffix. This rewrites them in place.

It is a data migration rather than a schema one on purpose: nothing about the
column changes, only the values inside it, and a deploy has to converge an
already-populated database.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'd4a9c12f7b83'
down_revision = 'c3f8b2a01d47'
branch_labels = None
depends_on = None

OLD_SUFFIX = "@okvault"
NEW_SUFFIX = "@okwault"


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
