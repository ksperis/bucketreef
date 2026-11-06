# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0254_canonical_healthcheck_status.py"
    )
    spec = util.spec_from_file_location(
        "migration_0254_canonical_healthcheck_status",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_tables(engine) -> dict[str, sa.Table]:
    metadata = sa.MetaData()
    tables = {
        table_name: sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("status", sa.String(), nullable=False),
        )
        for table_name in (
            "endpoint_health_checks",
            "endpoint_health_latest",
            "endpoint_health_status_segments",
        )
    }
    metadata.create_all(engine)
    return tables


def test_migration_canonicalizes_statuses_and_enforces_constraints():
    engine = sa.create_engine("sqlite:///:memory:")
    tables = _create_tables(engine)
    migration = _load_migration()
    inputs = {
        "endpoint_health_checks": " UP ",
        "endpoint_health_latest": " DeGrAdEd ",
        "endpoint_health_status_segments": " UNKNOWN ",
    }

    with engine.begin() as connection:
        for table_name, table in tables.items():
            connection.execute(
                table.insert().values(id=1, status=inputs[table_name])
            )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        inspector = sa.inspect(connection)
        expected = {
            "endpoint_health_checks": "up",
            "endpoint_health_latest": "degraded",
            "endpoint_health_status_segments": "unknown",
        }
        for table_name, table in tables.items():
            assert connection.scalar(sa.select(table.c.status)) == expected[table_name]
            constraints = {
                item["name"]
                for item in inspector.get_check_constraints(table_name)
            }
            assert migration._TABLE_CONSTRAINTS[table_name] in constraints
            with pytest.raises(sa.exc.IntegrityError):
                connection.execute(table.insert().values(id=2, status="paused"))


def test_migration_rejects_unknown_status():
    engine = sa.create_engine("sqlite:///:memory:")
    tables = _create_tables(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            tables["endpoint_health_latest"].insert().values(id=1, status="paused")
        )
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(RuntimeError, match="Unsupported healthcheck statuses"):
            migration.upgrade()
