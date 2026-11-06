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
        / "0240_retire_bucket_migration_skipped_status.py"
    )
    spec = util.spec_from_file_location(
        "migration_0240_retire_bucket_migration_skipped_status",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_skipped_items_and_recomputes_canceled_counter(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("skipped_items", sa.Integer(), nullable=False),
    )
    items = sa.Table(
        "bucket_migration_items",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("migration_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("step", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            [
                {"id": 1, "skipped_items": 1},
                {"id": 2, "skipped_items": 0},
            ],
        )
        connection.execute(
            items.insert(),
            [
                {"id": 10, "migration_id": 1, "status": "skipped", "step": "skipped"},
                {"id": 11, "migration_id": 1, "status": "canceled", "step": "sync"},
                {"id": 20, "migration_id": 2, "status": "completed", "step": "completed"},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("bucket_migrations")
        }
        assert "canceled_items" in columns
        assert "skipped_items" not in columns
        rows = connection.execute(
            sa.text("SELECT id, canceled_items FROM bucket_migrations ORDER BY id")
        ).mappings().all()
        assert [dict(row) for row in rows] == [
            {"id": 1, "canceled_items": 2},
            {"id": 2, "canceled_items": 0},
        ]
        item_rows = connection.execute(
            sa.text("SELECT id, status, step FROM bucket_migration_items ORDER BY id")
        ).mappings().all()
        assert [dict(row) for row in item_rows] == [
            {"id": 10, "status": "canceled", "step": "skipped"},
            {"id": 11, "status": "canceled", "step": "sync"},
            {"id": 20, "status": "completed", "step": "completed"},
        ]

        migration.downgrade()
        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("bucket_migrations")
        }
        assert "skipped_items" in columns
        assert "canceled_items" not in columns
        assert connection.execute(
            sa.text("SELECT skipped_items FROM bucket_migrations ORDER BY id")
        ).scalars().all() == [0, 0]
