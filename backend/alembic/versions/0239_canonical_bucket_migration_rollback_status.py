# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize the retired bucket-migration rollback status.

Revision ID: 0239_canonical_migration_rollback_status
Revises: 0238_remove_retired_migration_webhooks
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0239_canonical_migration_rollback_status"
down_revision = "0238_remove_retired_migration_webhooks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    affected_migration_ids = bind.execute(
        sa.text(
            "SELECT id FROM bucket_migrations WHERE status='rolled_back' "
            "UNION "
            "SELECT migration_id FROM bucket_migration_items WHERE status='rolled_back'"
        )
    ).scalars().all()

    bind.execute(
        sa.text(
            "UPDATE bucket_migration_items "
            "SET status='canceled' WHERE status='rolled_back'"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE bucket_migrations "
            "SET status='canceled' WHERE status='rolled_back'"
        )
    )

    for migration_id in affected_migration_ids:
        bind.execute(
            sa.text(
                "UPDATE bucket_migrations SET "
                "total_items=(SELECT COUNT(*) FROM bucket_migration_items i "
                "WHERE i.migration_id=:migration_id), "
                "completed_items=(SELECT COUNT(*) FROM bucket_migration_items i "
                "WHERE i.migration_id=:migration_id AND i.status='completed'), "
                "failed_items=(SELECT COUNT(*) FROM bucket_migration_items i "
                "WHERE i.migration_id=:migration_id AND i.status='failed'), "
                "skipped_items=(SELECT COUNT(*) FROM bucket_migration_items i "
                "WHERE i.migration_id=:migration_id AND i.status='skipped'), "
                "awaiting_items=(SELECT COUNT(*) FROM bucket_migration_items i "
                "WHERE i.migration_id=:migration_id AND i.status='awaiting_cutover') "
                "WHERE id=:migration_id"
            ),
            {"migration_id": migration_id},
        )


def downgrade() -> None:
    # Existing canceled rows cannot be distinguished from rows normalized by
    # this migration. Older application versions already accept canceled.
    pass
