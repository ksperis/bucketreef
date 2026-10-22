# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Include the RGW tenant in bucket usage statistics identity.

Revision ID: 0180_bucket_usage_stats_tenant_identity
Revises: 0179_bucket_migration_execution_strategy
Create Date: 2026-10-22 21:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0180_bucket_usage_stats_tenant_identity"
down_revision = "0179_bucket_migration_execution_strategy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_usage_stats_snapshots") as batch:
        batch.drop_constraint("uq_bucket_usage_stats_scope_bucket", type_="unique")
        batch.add_column(
            sa.Column("bucket_tenant", sa.String(), nullable=False, server_default="")
        )
        batch.create_unique_constraint(
            "uq_bucket_usage_stats_scope_bucket",
            ["scope_kind", "scope_id", "bucket_tenant", "bucket_name"],
        )


def downgrade() -> None:
    with op.batch_alter_table("bucket_usage_stats_snapshots") as batch:
        batch.drop_constraint("uq_bucket_usage_stats_scope_bucket", type_="unique")
        batch.drop_column("bucket_tenant")
        batch.create_unique_constraint(
            "uq_bucket_usage_stats_scope_bucket",
            ["scope_kind", "scope_id", "bucket_name"],
        )
