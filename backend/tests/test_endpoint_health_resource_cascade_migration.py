# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


_TABLES = (
    "endpoint_health_checks",
    "endpoint_health_latest",
    "endpoint_health_status_segments",
    "endpoint_health_rollups",
)


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0267_endpoint_health_resource_cascades.py"
    )
    spec = util.spec_from_file_location(
        "migration_0267_endpoint_health_resource_cascades",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine) -> None:
    metadata = sa.MetaData()
    storage_endpoints = sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    for table_name in _TABLES:
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(
                ["storage_endpoint_id"],
                [storage_endpoints.c.id],
            ),
        )
    metadata.create_all(engine)


def _ondelete(connection, table_name: str) -> str | None:
    foreign_key = next(
        item
        for item in sa.inspect(connection).get_foreign_keys(table_name)
        if item["constrained_columns"] == ["storage_endpoint_id"]
    )
    return foreign_key.get("options", {}).get("ondelete")


def test_migration_sets_endpoint_health_foreign_keys_to_cascade() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        for table_name in _TABLES:
            assert _ondelete(connection, table_name) == "CASCADE"


def test_migration_downgrade_restores_endpoint_health_foreign_keys() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        for table_name in _TABLES:
            assert _ondelete(connection, table_name) is None
