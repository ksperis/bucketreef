# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused per-bucket cost storage snapshots.

Revision ID: 0250_remove_cost_by_bucket
Revises: 0249_canonical_browser_favorites
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0250_remove_cost_by_bucket"
down_revision = "0249_canonical_browser_favorites"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("cost_storage_daily") as batch:
        batch.drop_column("by_bucket")


def downgrade() -> None:
    with op.batch_alter_table("cost_storage_daily") as batch:
        batch.add_column(
            sa.Column(
                "by_bucket",
                sa.JSON(none_as_null=True),
                nullable=True,
            )
        )
