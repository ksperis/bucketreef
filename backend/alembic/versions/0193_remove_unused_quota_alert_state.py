# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused quota alert state history fields.

Revision ID: 0193_remove_unused_quota_alert_state
Revises: 0192_remove_endpoint_health_checks_count
Create Date: 2026-10-24 19:20:00.000000
"""

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0193_remove_unused_quota_alert_state"
down_revision = "0192_remove_endpoint_health_checks_count"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("quota_alert_states") as batch:
        batch.drop_column("last_ratio_pct")
        batch.drop_column("last_checked_at")
        batch.drop_column("last_notified_level")
        batch.drop_column("last_notified_at")


def downgrade() -> None:
    with op.batch_alter_table("quota_alert_states") as batch:
        batch.add_column(sa.Column("last_ratio_pct", sa.Numeric(8, 3), nullable=True))
        batch.add_column(sa.Column("last_checked_at", UTCDateTime(), nullable=True))
        batch.add_column(sa.Column("last_notified_level", sa.String(), nullable=True))
        batch.add_column(sa.Column("last_notified_at", UTCDateTime(), nullable=True))

    op.execute(
        "UPDATE quota_alert_states SET last_checked_at = updated_at "
        "WHERE last_checked_at IS NULL"
    )
    with op.batch_alter_table("quota_alert_states") as batch:
        batch.alter_column(
            "last_checked_at",
            existing_type=UTCDateTime(),
            nullable=False,
        )
