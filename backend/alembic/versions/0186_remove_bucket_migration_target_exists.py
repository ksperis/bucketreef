# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused bucket migration target existence state.

Revision ID: 0186_remove_bucket_migration_target_exists
Revises: 0185_remove_bucket_migration_mapping_prefix
Create Date: 2026-10-24 18:20:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0186_remove_bucket_migration_target_exists"
down_revision = "0185_remove_bucket_migration_mapping_prefix"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.drop_column("target_bucket_exists")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.add_column(
            sa.Column(
                "target_bucket_exists",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
