# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused top-level bucket-migration runtime timestamps.

Revision ID: 0248_remove_migration_runtime_timestamps
Revises: 0247_remove_migration_last_heartbeat
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa

from app.db.utc_datetime import UTCDateTime


revision = "0248_remove_migration_runtime_timestamps"
down_revision = "0247_remove_migration_last_heartbeat"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_column("started_at")
        batch.drop_column("finished_at")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(sa.Column("started_at", UTCDateTime(), nullable=True))
        batch.add_column(sa.Column("finished_at", UTCDateTime(), nullable=True))
