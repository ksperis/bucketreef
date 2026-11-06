# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove duplicated bucket-migration checked revision.

Revision ID: 0246_remove_migration_checked_revision
Revises: 0245_remove_migration_target_snapshot
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0246_remove_migration_checked_revision"
down_revision = "0245_remove_migration_target_snapshot"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_column("checked_revision")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(sa.Column("checked_revision", sa.Integer(), nullable=True))

    op.execute(
        sa.text(
            "UPDATE bucket_migrations "
            "SET checked_revision = configuration_revision "
            "WHERE preparation_status = 'ready'"
        )
    )
