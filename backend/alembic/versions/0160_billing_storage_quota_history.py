"""Persist daily billing storage quota observations."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0160_billing_storage_quota_history"
down_revision = "0159_billing_rate_card_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("billing_storage_daily") as batch:
        batch.add_column(sa.Column("quota_size_bytes", sa.BigInteger(), nullable=True))
        batch.add_column(
            sa.Column(
                "quota_state",
                sa.String(),
                nullable=False,
                server_default="missing",
            )
        )
        batch.create_check_constraint(
            "ck_billing_storage_daily_quota_state",
            "quota_state IN ('valid', 'missing', 'disabled', 'unlimited', 'invalid')",
        )


def downgrade() -> None:
    with op.batch_alter_table("billing_storage_daily") as batch:
        batch.drop_constraint("ck_billing_storage_daily_quota_state", type_="check")
        batch.drop_column("quota_state")
        batch.drop_column("quota_size_bytes")
