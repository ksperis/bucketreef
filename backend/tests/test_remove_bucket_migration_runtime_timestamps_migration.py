# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from datetime import datetime
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
        / "0248_remove_bucket_migration_runtime_timestamps.py"
    )
    spec = util.spec_from_file_location(
        "migration_0248_remove_bucket_migration_runtime_timestamps",
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


def test_migration_removes_and_restores_unused_runtime_timestamps(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert().values(
                id=1,
                started_at=datetime(2026, 11, 6, 6, 0, 0),
                finished_at=datetime(2026, 11, 6, 6, 5, 0),
                updated_at=datetime(2026, 11, 6, 6, 5, 0),
            )
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = _column_names(connection)
        assert "started_at" not in columns
        assert "finished_at" not in columns
        assert connection.scalar(
            sa.text("SELECT updated_at FROM bucket_migrations WHERE id = 1")
        ) is not None

        migration.downgrade()

        columns = _column_names(connection)
        assert "started_at" in columns
        assert "finished_at" in columns
        row = connection.execute(
            sa.text(
                "SELECT started_at, finished_at, updated_at "
                "FROM bucket_migrations WHERE id = 1"
            )
        ).one()
        assert row[0] is None
        assert row[1] is None
        assert row[2] is not None
