"""Scratch cards that remember being scratched

Revision ID: b6e1c04a7f52
Revises: c1d5a70b4e62
Create Date: 2026-10-09 23:40:00.000000

A payment's draw is already written down (`coin_awards`), and the card that
hides it only ever existed on the receipt screen — so a card nobody scratched
was lost the moment the receipt was closed, and the coins it held could never be
shown as a card again. `coin_awards.scratched_at` is what makes the reveal a
fact rather than a screen state: null means the coins are still under the cover
and the card can be handed over again, a timestamp means the user has seen them.

Existing payment awards are backfilled as scratched. They were revealed on the
receipt of the payment that won them, so presenting them as unscratched cards
today would offer a scratch for coins the user has already counted. The welcome
bonus and offer payouts are left alone deliberately: they are credited and
announced outright rather than hidden under a cover, so they are not cards.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b6e1c04a7f52'
down_revision = 'c1d5a70b4e62'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('coin_awards', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('scratched_at', sa.DateTime(timezone=True), nullable=True)
        )

    # Everything already on record was revealed as it was won.
    op.execute(
        "UPDATE coin_awards SET scratched_at = created_at "
        "WHERE reason = 'payment' AND scratched_at IS NULL"
    )


def downgrade():
    with op.batch_alter_table('coin_awards', schema=None) as batch_op:
        batch_op.drop_column('scratched_at')
