# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused latest endpoint-health availability value.

Revision ID: 0241_remove_latest_availability
Revises: 0240_retire_migration_skipped_status
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0241_remove_latest_availability"
down_revision = "0240_retire_migration_skipped_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("endpoint_health_latest") as batch:
        batch.drop_column("availability_24h")


def downgrade() -> None:
    with op.batch_alter_table("endpoint_health_latest") as batch:
        batch.add_column(sa.Column("availability_24h", sa.Integer(), nullable=True))
