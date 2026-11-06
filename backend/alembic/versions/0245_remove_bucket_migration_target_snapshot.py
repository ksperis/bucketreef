# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused bucket-migration target snapshot.

Revision ID: 0245_remove_migration_target_snapshot
Revises: 0244_remove_migration_precheck_status
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0245_remove_migration_target_snapshot"
down_revision = "0244_remove_migration_precheck_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.drop_column("target_snapshot")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migration_items") as batch:
        batch.add_column(
            sa.Column(
                "target_snapshot",
                sa.JSON(none_as_null=True),
                nullable=True,
            )
        )
