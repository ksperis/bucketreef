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
        / "0244_remove_bucket_migration_precheck_status.py"
    )
    spec = util.spec_from_file_location(
        "migration_0244_remove_bucket_migration_precheck_status",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("bucket_migrations")
    }


def _index_names(connection) -> set[str]:
    return {
        index["name"]
        for index in sa.inspect(connection).get_indexes("bucket_migrations")
    }


def test_migration_removes_duplicate_precheck_status_and_restores_from_preparation(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("precheck_status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("preparation_status", sa.String(), nullable=False),
    )
    sa.Index("ix_bucket_migrations_precheck_status", migrations.c.precheck_status)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            [
                {"id": 1, "precheck_status": "passed", "preparation_status": "ready"},
                {"id": 2, "precheck_status": "failed", "preparation_status": "blocked"},
                {"id": 3, "precheck_status": "pending", "preparation_status": "stale"},
            ],
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "precheck_status" not in _column_names(connection)
        assert "ix_bucket_migrations_precheck_status" not in _index_names(connection)
        assert connection.execute(
            sa.text("SELECT id, preparation_status FROM bucket_migrations ORDER BY id")
        ).all() == [(1, "ready"), (2, "blocked"), (3, "stale")]

        migration.downgrade()

        assert "precheck_status" in _column_names(connection)
        assert "ix_bucket_migrations_precheck_status" in _index_names(connection)
        assert connection.execute(
            sa.text("SELECT id, precheck_status FROM bucket_migrations ORDER BY id")
        ).all() == [(1, "passed"), (2, "failed"), (3, "pending")]
