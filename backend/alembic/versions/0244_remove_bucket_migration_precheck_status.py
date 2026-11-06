# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove duplicated bucket-migration precheck status.

Revision ID: 0244_remove_migration_precheck_status
Revises: 0243_remove_context_service_name
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0244_remove_migration_precheck_status"
down_revision = "0243_remove_context_service_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.drop_index("ix_bucket_migrations_precheck_status")
        batch.drop_column("precheck_status")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.add_column(
            sa.Column(
                "precheck_status",
                sa.String(),
                nullable=False,
                server_default="pending",
            )
        )
        batch.create_index(
            "ix_bucket_migrations_precheck_status",
            ["precheck_status"],
            unique=False,
        )

    op.execute(
        sa.text(
            "UPDATE bucket_migrations "
            "SET precheck_status = CASE "
            "WHEN preparation_status = 'ready' THEN 'passed' "
            "WHEN preparation_status = 'blocked' THEN 'failed' "
            "ELSE 'pending' END"
        )
    )
