# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove redundant bucket migration pause and cancel request flags.

Revision ID: 0188_remove_bucket_migration_request_flags
Revises: 0187_remove_bucket_migration_cleanup_status
Create Date: 2026-10-24 19:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "0188_remove_bucket_migration_request_flags"
down_revision = "0187_remove_bucket_migration_cleanup_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_column("pause_requested")
        batch.drop_column("cancel_requested")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(
            sa.Column(
                "pause_requested",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch.add_column(
            sa.Column(
                "cancel_requested",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
    op.execute(
        "UPDATE bucket_migrations "
        "SET pause_requested = CASE WHEN status = 'pause_requested' THEN 1 ELSE 0 END, "
        "cancel_requested = CASE WHEN status = 'cancel_requested' THEN 1 ELSE 0 END"
    )
