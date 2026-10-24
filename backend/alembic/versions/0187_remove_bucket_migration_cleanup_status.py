# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused per-item cleanup status.

Revision ID: 0187_remove_bucket_migration_cleanup_status
Revises: 0186_remove_bucket_migration_target_exists
Create Date: 2026-10-24 18:35:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0187_remove_bucket_migration_cleanup_status"
down_revision = "0186_remove_bucket_migration_target_exists"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.drop_column("cleanup_status")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.add_column(
            sa.Column(
                "cleanup_status",
                sa.String(),
                nullable=False,
                server_default="idle",
            )
        )
