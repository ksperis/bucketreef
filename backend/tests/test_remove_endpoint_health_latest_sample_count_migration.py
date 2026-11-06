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
        / "0242_remove_endpoint_health_latest_sample_count.py"
    )
    spec = util.spec_from_file_location(
        "migration_0242_remove_endpoint_health_latest_sample_count",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("endpoint_health_latest")
    }


def test_migration_removes_and_restores_unused_latest_sample_count(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    latest = sa.Table(
        "endpoint_health_latest",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("avg_latency_ms", sa.Integer(), nullable=True),
        sa.Column("latency_sample_count", sa.Integer(), nullable=False, server_default="0"),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            latest.insert().values(id=1, avg_latency_ms=42, latency_sample_count=7)
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "latency_sample_count" not in _column_names(connection)
        assert connection.execute(
            sa.text("SELECT avg_latency_ms FROM endpoint_health_latest WHERE id = 1")
        ).scalar_one() == 42

        migration.downgrade()

        assert "latency_sample_count" in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT avg_latency_ms, latency_sample_count "
                "FROM endpoint_health_latest WHERE id = 1"
            )
        ).one()
        assert tuple(row) == (42, 0)
