# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused operation lease acquisition timestamp.

Revision ID: 0190_remove_operation_lease_acquired_at
Revises: 0189_remove_onboarding_journey_dead_state
Create Date: 2026-10-24 19:45:00.000000
"""

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0190_remove_operation_lease_acquired_at"
down_revision = "0189_remove_onboarding_journey_dead_state"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("backend_operation_leases") as batch:
        batch.drop_column("acquired_at")


def downgrade() -> None:
    with op.batch_alter_table("backend_operation_leases") as batch:
        batch.add_column(sa.Column("acquired_at", UTCDateTime(), nullable=True))
    op.execute(
        "UPDATE backend_operation_leases SET acquired_at = updated_at "
        "WHERE acquired_at IS NULL"
    )
    with op.batch_alter_table("backend_operation_leases") as batch:
        batch.alter_column(
            "acquired_at",
            existing_type=UTCDateTime(),
            nullable=False,
        )
