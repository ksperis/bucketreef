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
        / "0192_remove_endpoint_health_checks_count.py"
    )
    spec = util.spec_from_file_location(
        "migration_0192_remove_endpoint_health_checks_count",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns(
            "endpoint_health_status_segments"
        )
    }


def test_migration_removes_and_restores_unused_segment_check_counter(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    segments = sa.Table(
        "endpoint_health_status_segments",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("checks_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_sample_count", sa.Integer(), nullable=False, server_default="0"),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            segments.insert().values(id=1, checks_count=7, latency_sample_count=5)
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "checks_count" not in _column_names(connection)
        assert connection.execute(
            sa.text(
                "SELECT latency_sample_count FROM endpoint_health_status_segments WHERE id = 1"
            )
        ).scalar_one() == 5

        migration.downgrade()

        assert "checks_count" in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT checks_count, latency_sample_count "
                "FROM endpoint_health_status_segments WHERE id = 1"
            )
        ).one()
        assert tuple(row) == (0, 5)
