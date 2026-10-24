# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove obsolete bucket migration mapping prefix.

Revision ID: 0185_remove_bucket_migration_mapping_prefix
Revises: 0184_remove_bucket_migration_report_safety
Create Date: 2026-10-24 18:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0185_remove_bucket_migration_mapping_prefix"
down_revision = "0184_remove_bucket_migration_report_safety"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_column("mapping_prefix")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(sa.Column("mapping_prefix", sa.String(), nullable=True))
