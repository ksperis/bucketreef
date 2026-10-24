# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused onboarding journey state.

Revision ID: 0189_remove_onboarding_journey_dead_state
Revises: 0188_remove_bucket_migration_request_flags
Create Date: 2026-10-24 19:30:00.000000
"""

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0189_remove_onboarding_journey_dead_state"
down_revision = "0188_remove_bucket_migration_request_flags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("onboarding_journeys") as batch:
        batch.drop_column("evidence_json")
        batch.drop_column("readiness_json")
        batch.drop_column("validated_at")


def downgrade() -> None:
    with op.batch_alter_table("onboarding_journeys") as batch:
        batch.add_column(
            sa.Column("evidence_json", sa.Text(), nullable=False, server_default="{}")
        )
        batch.add_column(
            sa.Column("readiness_json", sa.Text(), nullable=False, server_default="{}")
        )
        batch.add_column(sa.Column("validated_at", UTCDateTime(), nullable=True))
