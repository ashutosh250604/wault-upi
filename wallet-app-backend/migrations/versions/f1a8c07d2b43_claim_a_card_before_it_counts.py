"""A draw counts when it is scratched, not when it is decided

Revision ID: f1a8c07d2b43
Revises: e7b3c5f21a08
Create Date: 2026-10-10 09:05:00.000000

The coin balance counted every award the moment it was written, so a payment
moved the balance by a random amount before the card over it had been opened —
and the receipt said the number out loud. The card was decoration.

`claimed_at` is when a draw becomes spendable, stamped by the claim
(`coins.claim_card`) and by nothing else. An award whose `claimed_at` is null is
decided and stored but not counted, and its amount is not sent to the client
either, so the prize cannot be read out of a response or a screenshot.

Rows written before this revision are backfilled as claimed. Under the old rule
their coins were already spendable, which means the amount is already inside
some balance: left null they would not have been hidden, they would have been
*subtracted* from every account in the service. `scratched_at` is deliberately
not touched, so a card that was never opened stays covered — the migration
records what is true (the coins count) rather than inventing a scratch nobody
made. Scratching such a card reveals its amount and credits nothing, because it
was counted the first time.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f1a8c07d2b43'
down_revision = 'e7b3c5f21a08'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "coin_awards", sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_index("ix_coin_awards_claimed_at", "coin_awards", ["claimed_at"])
    op.execute("UPDATE coin_awards SET claimed_at = created_at WHERE claimed_at IS NULL")


def downgrade():
    op.drop_index("ix_coin_awards_claimed_at", table_name="coin_awards")
    op.drop_column("coin_awards", "claimed_at")
