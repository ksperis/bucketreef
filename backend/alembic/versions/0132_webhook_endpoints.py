# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Add durable global webhook endpoints and migrate migration callbacks.

Revision ID: 0132_webhook_endpoints
Revises: 0131_canonical_onboarding_journeys
Create Date: 2026-09-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.db.utc_datetime import UTCDateTime
from app.utils.time import utcnow


revision = "0132_webhook_endpoints"
down_revision = "0131_canonical_onboarding_journeys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhook_endpoints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("signing_secret", sa.String(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_webhook_endpoints_name"),
    )
    op.create_index("ix_webhook_endpoints_id", "webhook_endpoints", ["id"], unique=False)
    op.create_index(
        "ix_webhook_endpoints_enabled_id",
        "webhook_endpoints",
        ["enabled", "id"],
        unique=False,
    )

    op.create_table(
        "webhook_endpoint_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("endpoint_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["endpoint_id"], ["webhook_endpoints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "endpoint_id",
            "event_type",
            name="uq_webhook_endpoint_subscription",
        ),
    )
    op.create_index(
        "ix_webhook_endpoint_subscriptions_id",
        "webhook_endpoint_subscriptions",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_endpoint_subscriptions_endpoint_id",
        "webhook_endpoint_subscriptions",
        ["endpoint_id"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_subscriptions_event_endpoint",
        "webhook_endpoint_subscriptions",
        ["event_type", "endpoint_id"],
        unique=False,
    )

    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("delivery_id", sa.String(), nullable=False),
        sa.Column("event_id", sa.String(), nullable=False),
        sa.Column("endpoint_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", UTCDateTime(), nullable=False),
        sa.Column("last_http_status", sa.Integer(), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.Column("delivered_at", UTCDateTime(), nullable=True),
        sa.ForeignKeyConstraint(["endpoint_id"], ["webhook_endpoints.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("delivery_id", name="uq_webhook_deliveries_delivery_id"),
    )
    op.create_index("ix_webhook_deliveries_id", "webhook_deliveries", ["id"], unique=False)
    op.create_index("ix_webhook_deliveries_event_id", "webhook_deliveries", ["event_id"], unique=False)
    op.create_index("ix_webhook_deliveries_endpoint_id", "webhook_deliveries", ["endpoint_id"], unique=False)
    op.create_index("ix_webhook_deliveries_event_type", "webhook_deliveries", ["event_type"], unique=False)
    op.create_index("ix_webhook_deliveries_status", "webhook_deliveries", ["status"], unique=False)
    op.create_index("ix_webhook_deliveries_next_attempt_at", "webhook_deliveries", ["next_attempt_at"], unique=False)
    op.create_index("ix_webhook_deliveries_created_at", "webhook_deliveries", ["created_at"], unique=False)
    op.create_index(
        "ix_webhook_deliveries_due",
        "webhook_deliveries",
        ["status", "next_attempt_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_deliveries_endpoint_created",
        "webhook_deliveries",
        ["endpoint_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_webhook_deliveries_event",
        "webhook_deliveries",
        ["event_id", "endpoint_id"],
        unique=False,
    )

    bind = op.get_bind()
    migrations = sa.table(
        "bucket_migrations",
        sa.column("webhook_url", sa.String()),
    )
    endpoints = sa.table(
        "webhook_endpoints",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("url", sa.Text()),
        sa.column("enabled", sa.Boolean()),
        sa.column("signing_secret", sa.String()),
        sa.column("created_at", UTCDateTime()),
        sa.column("updated_at", UTCDateTime()),
    )
    subscriptions = sa.table(
        "webhook_endpoint_subscriptions",
        sa.column("endpoint_id", sa.Integer()),
        sa.column("event_type", sa.String()),
    )

    raw_urls = bind.execute(
        sa.select(migrations.c.webhook_url).where(migrations.c.webhook_url.is_not(None))
    ).scalars().all()
    urls = sorted({str(value).strip() for value in raw_urls if str(value or "").strip()})
    now = utcnow()
    for index, url in enumerate(urls, start=1):
        name = f"Imported migration webhook {index}"
        bind.execute(
            endpoints.insert().values(
                name=name,
                url=url,
                enabled=False,
                signing_secret=None,
                created_at=now,
                updated_at=now,
            )
        )
        endpoint_id = bind.execute(
            sa.select(endpoints.c.id).where(endpoints.c.name == name)
        ).scalar_one()
        bind.execute(
            subscriptions.insert().values(
                endpoint_id=endpoint_id,
                event_type="manager.bucket_migration.event",
            )
        )

    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.drop_column("webhook_url")


def downgrade() -> None:
    with op.batch_alter_table("bucket_migrations", schema=None) as batch_op:
        batch_op.add_column(sa.Column("webhook_url", sa.String(), nullable=True))

    op.drop_index("ix_webhook_deliveries_event", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_endpoint_created", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_due", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_created_at", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_next_attempt_at", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_status", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_event_type", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_endpoint_id", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_event_id", table_name="webhook_deliveries")
    op.drop_index("ix_webhook_deliveries_id", table_name="webhook_deliveries")
    op.drop_table("webhook_deliveries")

    op.drop_index(
        "ix_webhook_subscriptions_event_endpoint",
        table_name="webhook_endpoint_subscriptions",
    )
    op.drop_index(
        "ix_webhook_endpoint_subscriptions_endpoint_id",
        table_name="webhook_endpoint_subscriptions",
    )
    op.drop_index(
        "ix_webhook_endpoint_subscriptions_id",
        table_name="webhook_endpoint_subscriptions",
    )
    op.drop_table("webhook_endpoint_subscriptions")

    op.drop_index("ix_webhook_endpoints_enabled_id", table_name="webhook_endpoints")
    op.drop_index("ix_webhook_endpoints_id", table_name="webhook_endpoints")
    op.drop_table("webhook_endpoints")
