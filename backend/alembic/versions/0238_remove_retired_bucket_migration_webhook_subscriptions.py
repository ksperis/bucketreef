# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove subscriptions for retired bucket-migration rollback audit events.

Revision ID: 0238_remove_retired_migration_webhooks
Revises: 0237_canonical_bucket_migration_retry_step
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0238_remove_retired_migration_webhooks"
down_revision = "0237_canonical_bucket_migration_retry_step"
branch_labels = None
depends_on = None

_RETIRED_EVENT_TYPES = (
    "audit.manager.rollback_bucket_migration",
    "audit.manager.rollback_bucket_migration_item",
    "audit.manager.rollback_failed_bucket_migration_items",
)


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM webhook_endpoint_subscriptions "
            "WHERE event_type IN (:rollback_migration, :rollback_item, :rollback_failed_items)"
        ),
        {
            "rollback_migration": _RETIRED_EVENT_TYPES[0],
            "rollback_item": _RETIRED_EVENT_TYPES[1],
            "rollback_failed_items": _RETIRED_EVENT_TYPES[2],
        },
    )


def downgrade() -> None:
    # Subscription ownership cannot be reconstructed after deletion. The older
    # application can add these event types again if an operator explicitly
    # recreates them after downgrade.
    pass
