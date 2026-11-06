# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Canonicalize the retired bucket-migration rollback failure retry step.

Revision ID: 0237_canonical_bucket_migration_retry_step
Revises: 0236_repair_portal_iam_revocation_schema
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0237_canonical_bucket_migration_retry_step"
down_revision = "0236_repair_portal_iam_revocation_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE bucket_migration_items "
            "SET step='sync' "
            "WHERE status='failed' AND step='rollback_failed' "
            "AND migration_id IN ("
            "SELECT id FROM bucket_migrations WHERE workflow_version=2"
            ")"
        )
    )


def downgrade() -> None:
    # The previous application already accepts ``sync`` for failed-item retry.
    # Reconstructing ``rollback_failed`` would be ambiguous because current
    # failures also legitimately persist ``sync``.
    pass
