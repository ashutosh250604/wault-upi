"""Rebrand wallet handles to @okvault

Revision ID: c3f8b2a01d47
Revises: e1a7c4dns0b9
Create Date: 2026-10-06 09:40:00.000000

A handle is part of a user's identity, so changing the default in config only
helps accounts created afterwards — every wallet that already exists would keep
advertising the old `@okwalletpay` suffix. This rewrites them in place, exactly
as `b7d1e4c90f27` did when the suffix moved to `@okwalletpay` in the first place.

It is a data migration rather than a schema one on purpose: nothing about the
column changes, only the values inside it, and a deploy has to converge an
already-populated database.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'c3f8b2a01d47'
down_revision = 'e1a7c4dns0b9'
branch_labels = None
depends_on = None

OLD_SUFFIX = "@okwalletpay"
NEW_SUFFIX = "@okvault"


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
