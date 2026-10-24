# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused endpoint health segment check counter.

Revision ID: 0192_remove_endpoint_health_checks_count
Revises: 0191_remove_first_admin_bootstrap_issued_at
Create Date: 2026-10-24 19:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0192_remove_endpoint_health_checks_count"
down_revision = "0191_remove_first_admin_bootstrap_issued_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("endpoint_health_status_segments") as batch:
        batch.drop_column("checks_count")


def downgrade() -> None:
    with op.batch_alter_table("endpoint_health_status_segments") as batch:
        batch.add_column(
            sa.Column(
                "checks_count",
                sa.Integer(),
                nullable=False,
                server_default="0",
            )
        )
