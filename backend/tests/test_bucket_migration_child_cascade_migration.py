# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


_TABLES = (
    "bucket_migration_items",
    "bucket_migration_events",
)


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0269_bucket_migration_child_cascades.py"
    )
    spec = util.spec_from_file_location(
        "migration_0269_bucket_migration_child_cascades",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine) -> None:
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    items = sa.Table(
        "bucket_migration_items",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("migration_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["migration_id"], [migrations.c.id]),
    )
    sa.Table(
        "bucket_migration_events",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("migration_id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["migration_id"], [migrations.c.id]),
        sa.ForeignKeyConstraint(["item_id"], [items.c.id]),
    )
    metadata.create_all(engine)


def _migration_ondelete(connection, table_name: str) -> str | None:
    foreign_key = next(
        item
        for item in sa.inspect(connection).get_foreign_keys(table_name)
        if item["constrained_columns"] == ["migration_id"]
    )
    return foreign_key.get("options", {}).get("ondelete")


def _item_ondelete(connection) -> str | None:
    foreign_key = next(
        item
        for item in sa.inspect(connection).get_foreign_keys("bucket_migration_events")
        if item["constrained_columns"] == ["item_id"]
    )
    return foreign_key.get("options", {}).get("ondelete")


def test_migration_sets_parent_foreign_keys_to_cascade_only() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        for table_name in _TABLES:
            assert _migration_ondelete(connection, table_name) == "CASCADE"
        assert _item_ondelete(connection) is None


def test_migration_downgrade_restores_parent_foreign_keys() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        for table_name in _TABLES:
            assert _migration_ondelete(connection, table_name) is None
        assert _item_ondelete(connection) is None
