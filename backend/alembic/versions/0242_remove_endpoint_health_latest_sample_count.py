# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused latest endpoint-health latency sample count.

Revision ID: 0242_remove_latest_sample_count
Revises: 0241_remove_latest_availability
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0242_remove_latest_sample_count"
down_revision = "0241_remove_latest_availability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("endpoint_health_latest") as batch:
        batch.drop_column("latency_sample_count")


def downgrade() -> None:
    with op.batch_alter_table("endpoint_health_latest") as batch:
        batch.add_column(
            sa.Column(
                "latency_sample_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )
