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
        / "0185_remove_bucket_migration_mapping_prefix.py"
    )
    spec = util.spec_from_file_location(
        "migration_0185_remove_bucket_migration_mapping_prefix",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_mapping_prefix(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("mapping_prefix", sa.String(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            {"id": 1, "mapping_prefix": "legacy-"},
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
        assert "mapping_prefix" not in columns

        migration.downgrade()
        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("bucket_migrations")
        }
        assert "mapping_prefix" in columns
        assert connection.execute(
            sa.text("SELECT mapping_prefix FROM bucket_migrations WHERE id = 1")
        ).scalar_one() is None
