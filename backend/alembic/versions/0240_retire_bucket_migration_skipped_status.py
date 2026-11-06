# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Retire the obsolete bucket-migration skipped status and counter.

Revision ID: 0240_retire_migration_skipped_status
Revises: 0239_canonical_migration_rollback_status
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0240_retire_migration_skipped_status"
down_revision = "0239_canonical_migration_rollback_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "UPDATE bucket_migration_items "
            "SET status='canceled' WHERE status='skipped'"
        )
    )

    with op.batch_alter_table("bucket_migrations") as batch:
        batch.alter_column(
            "skipped_items",
            existing_type=sa.Integer(),
            new_column_name="canceled_items",
        )

    bind.execute(
        sa.text(
            "UPDATE bucket_migrations SET "
            "canceled_items=(SELECT COUNT(*) FROM bucket_migration_items i "
            "WHERE i.migration_id=bucket_migrations.id AND i.status='canceled')"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    with op.batch_alter_table("bucket_migrations") as batch:
        batch.alter_column(
            "canceled_items",
            existing_type=sa.Integer(),
            new_column_name="skipped_items",
        )

    # The upgrade canonicalizes historical skipped rows to canceled, and they
    # cannot be distinguished from ordinary canceled rows afterwards. Older
    # application versions already accept canceled item statuses.
    bind.execute(sa.text("UPDATE bucket_migrations SET skipped_items=0"))
