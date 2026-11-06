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
        / "0245_remove_bucket_migration_target_snapshot.py"
    )
    spec = util.spec_from_file_location(
        "migration_0245_remove_bucket_migration_target_snapshot",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("bucket_migration_items")
    }


def test_migration_removes_and_restores_unused_target_snapshot(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    items = sa.Table(
        "bucket_migration_items",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_snapshot", sa.JSON(), nullable=True),
        sa.Column("target_snapshot", sa.JSON(), nullable=True),
        sa.Column("execution_strategy", sa.String(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            items.insert().values(
                id=1,
                source_snapshot={"versioning": {"status": "Enabled"}},
                target_snapshot={"versioning": {"status": "Suspended"}},
                execution_strategy="copy",
            )
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "target_snapshot" not in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT source_snapshot, execution_strategy "
                "FROM bucket_migration_items WHERE id = 1"
            )
        ).one()
        assert row[0] is not None
        assert row[1] == "copy"

        migration.downgrade()

        assert "target_snapshot" in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT source_snapshot, target_snapshot, execution_strategy "
                "FROM bucket_migration_items WHERE id = 1"
            )
        ).one()
        assert row[0] is not None
        assert row[1] is None
        assert row[2] == "copy"
