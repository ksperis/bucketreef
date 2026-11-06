# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0238_remove_retired_bucket_migration_webhook_subscriptions.py"
    )
    spec = util.spec_from_file_location(
        "migration_0238_remove_retired_bucket_migration_webhook_subscriptions",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_only_retired_bucket_migration_webhook_subscriptions(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    subscriptions = sa.Table(
        "webhook_endpoint_subscriptions",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("endpoint_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            subscriptions.insert(),
            [
                {"id": 1, "endpoint_id": 10, "event_type": "audit.manager.rollback_bucket_migration"},
                {"id": 2, "endpoint_id": 10, "event_type": "audit.manager.rollback_bucket_migration_item"},
                {"id": 3, "endpoint_id": 11, "event_type": "audit.manager.rollback_failed_bucket_migration_items"},
                {"id": 4, "endpoint_id": 10, "event_type": "audit.manager.retry_bucket_migration_item"},
                {"id": 5, "endpoint_id": 12, "event_type": "*"},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        rows = connection.execute(
            sa.text(
                "SELECT endpoint_id, event_type FROM webhook_endpoint_subscriptions "
                "ORDER BY id"
            )
        ).all()
        assert rows == [
            (10, "audit.manager.retry_bucket_migration_item"),
            (12, "*"),
        ]

        migration.downgrade()
        assert connection.scalar(
            sa.text("SELECT count(*) FROM webhook_endpoint_subscriptions")
        ) == 2
