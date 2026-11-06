# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import sqlalchemy as sa


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0250_remove_cost_storage_by_bucket.py"
    )
    spec = util.spec_from_file_location(
        "migration_0250_remove_cost_storage_by_bucket",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("cost_storage_daily")
    }


def test_migration_removes_and_restores_unused_bucket_breakdown(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    storage = sa.Table(
        "cost_storage_daily",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("total_bytes", sa.BigInteger(), nullable=False),
        sa.Column("total_objects", sa.BigInteger(), nullable=False),
        sa.Column("by_bucket", sa.JSON(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            storage.insert().values(
                id=1,
                total_bytes=1234,
                total_objects=5,
                by_bucket={
                    "archive": {"used_bytes": 1234, "object_count": 5},
                },
                source="rgw_admin_bucket_stats",
            )
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "by_bucket" not in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT total_bytes, total_objects, source "
                "FROM cost_storage_daily WHERE id = 1"
            )
        ).one()
        assert row == (1234, 5, "rgw_admin_bucket_stats")

        migration.downgrade()

        assert "by_bucket" in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT total_bytes, total_objects, by_bucket, source "
                "FROM cost_storage_daily WHERE id = 1"
            )
        ).one()
        assert row[0] == 1234
        assert row[1] == 5
        assert row[2] is None
        assert row[3] == "rgw_admin_bucket_stats"
