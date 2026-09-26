# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0132_webhook_endpoints.py"
    )
    spec = util.spec_from_file_location("migration_0132_webhook_endpoints", path)
    assert spec and spec.loader
    module = util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_0131_bucket_migration_shape(engine) -> None:
    metadata = sa.MetaData()
    sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("webhook_url", sa.String(), nullable=True),
    )
    metadata.create_all(engine)


def test_webhook_migration_deduplicates_legacy_urls_and_disables_imported_endpoints(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    _create_0131_bucket_migration_shape(engine)

    with engine.begin() as connection:
        connection.execute(
            sa.text("INSERT INTO bucket_migrations (id, webhook_url) VALUES (:id, :url)"),
            [
                {"id": 1, "url": "https://hooks.example.test/migration-a"},
                {"id": 2, "url": "https://hooks.example.test/migration-a"},
                {"id": 3, "url": " https://hooks.example.test/migration-b "},
                {"id": 4, "url": None},
                {"id": 5, "url": ""},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))

        migration.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_migrations")}
        assert "webhook_url" not in columns
        endpoints = connection.execute(
            sa.text(
                "SELECT id, name, url, enabled, signing_secret "
                "FROM webhook_endpoints ORDER BY id"
            )
        ).mappings().all()
        assert [(row["name"], row["url"]) for row in endpoints] == [
            ("Imported migration webhook 1", "https://hooks.example.test/migration-a"),
            ("Imported migration webhook 2", "https://hooks.example.test/migration-b"),
        ]
        assert all(not bool(row["enabled"]) for row in endpoints)
        assert all(row["signing_secret"] is None for row in endpoints)
        subscriptions = connection.execute(
            sa.text(
                "SELECT endpoint_id, event_type "
                "FROM webhook_endpoint_subscriptions ORDER BY endpoint_id"
            )
        ).all()
        assert subscriptions == [
            (endpoints[0]["id"], "manager.bucket_migration.event"),
            (endpoints[1]["id"], "manager.bucket_migration.event"),
        ]

        migration.downgrade()
        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_migrations")}
        assert "webhook_url" in columns
        tables = set(sa.inspect(connection).get_table_names())
        assert "webhook_endpoints" not in tables
        assert "webhook_endpoint_subscriptions" not in tables
        assert "webhook_deliveries" not in tables
