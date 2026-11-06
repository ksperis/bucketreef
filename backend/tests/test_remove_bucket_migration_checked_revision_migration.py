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
        / "0246_remove_bucket_migration_checked_revision.py"
    )
    spec = util.spec_from_file_location(
        "migration_0246_remove_bucket_migration_checked_revision",
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


def test_migration_removes_and_reconstructs_checked_revision(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("configuration_revision", sa.Integer(), nullable=False),
        sa.Column("checked_revision", sa.Integer(), nullable=True),
        sa.Column("preparation_status", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            [
                {
                    "id": 1,
                    "configuration_revision": 4,
                    "checked_revision": 4,
                    "preparation_status": "ready",
                },
                {
                    "id": 2,
                    "configuration_revision": 7,
                    "checked_revision": None,
                    "preparation_status": "blocked",
                },
                {
                    "id": 3,
                    "configuration_revision": 9,
                    "checked_revision": None,
                    "preparation_status": "stale",
                },
            ],
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "checked_revision" not in _column_names(connection)
        assert connection.execute(
            sa.text(
                "SELECT id, configuration_revision, preparation_status "
                "FROM bucket_migrations ORDER BY id"
            )
        ).all() == [(1, 4, "ready"), (2, 7, "blocked"), (3, 9, "stale")]

        migration.downgrade()

        assert "checked_revision" in _column_names(connection)
        assert connection.execute(
            sa.text(
                "SELECT id, checked_revision FROM bucket_migrations ORDER BY id"
            )
        ).all() == [(1, 4), (2, None), (3, None)]
