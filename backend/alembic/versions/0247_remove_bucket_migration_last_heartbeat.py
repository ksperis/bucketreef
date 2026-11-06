# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused bucket-migration heartbeat timestamp.

Revision ID: 0247_remove_migration_last_heartbeat
Revises: 0246_remove_migration_checked_revision
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0247_remove_migration_last_heartbeat"
down_revision = "0246_remove_migration_checked_revision"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_column("last_heartbeat_at")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(
            sa.Column("last_heartbeat_at", UTCDateTime(), nullable=True)
        )
