"""Offer payouts and the welcome bonus are cards too

Revision ID: d2a7b15c9e60
Revises: b6e1c04a7f52
Create Date: 2026-10-10 00:30:00.000000

The collection screen listed only a payment's draw, because only a payment had
a card handed over on a receipt. Every coin award is the same kind of thing — a
payout that lands the moment it is won — so offers and the welcome bonus belong
in the same collection, and `coins.card_collection` no longer filters by reason.

Those older awards are backfilled as scratched, exactly as the payment awards
were in the previous revision: they were credited and announced outright in the
inbox, so listing them as cards still under a cover would offer a scratch for
coins the user has already counted. Only a card won from here on arrives
covered.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'd2a7b15c9e60'
down_revision = 'b6e1c04a7f52'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE coin_awards SET scratched_at = created_at WHERE scratched_at IS NULL"
    )


def downgrade():
    # Nothing to undo: the rows this stamped carry their own created_at, and
    # whether a scratch happened is not recoverable from the schema.
    pass
