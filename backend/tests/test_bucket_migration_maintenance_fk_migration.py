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
        / "0264_bucket_migration_maintenance_requester_fk.py"
    )
    spec = util.spec_from_file_location(
        "migration_0264_bucket_migration_maintenance_requester_fk",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(
    engine, *, include_requester_column: bool = True, include_requester_fk: bool = True
) -> None:
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    bucket_migrations = sa.Table(
        "bucket_migrations", metadata, sa.Column("id", sa.Integer(), primary_key=True)
    )
    if include_requester_column:
        bucket_migrations.append_column(
            sa.Column("maintenance_requested_by_user_id", sa.Integer(), nullable=True)
        )
    if include_requester_fk:
        bucket_migrations.append_constraint(
            sa.ForeignKeyConstraint(
                ["maintenance_requested_by_user_id"],
                [users.c.id],
                name="fk_bucket_migrations_maintenance_user",
            )
        )
    metadata.create_all(engine)


def _ondelete(connection) -> str | None:
    foreign_key = next(
        item
        for item in sa.inspect(connection).get_foreign_keys("bucket_migrations")
        if item["constrained_columns"] == ["maintenance_requested_by_user_id"]
    )
    return foreign_key.get("options", {}).get("ondelete")


def test_migration_sets_maintenance_requester_foreign_key_to_set_null() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        assert _ondelete(connection) == "SET NULL"


def test_migration_repairs_missing_maintenance_requester_column() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(
        engine, include_requester_column=False, include_requester_fk=False
    )
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        columns = {
            item["name"]
            for item in sa.inspect(connection).get_columns("bucket_migrations")
        }
        assert "maintenance_requested_by_user_id" in columns
        assert _ondelete(connection) == "SET NULL"


def test_migration_repairs_missing_maintenance_requester_foreign_key() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine, include_requester_fk=False)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        assert _ondelete(connection) == "SET NULL"


def test_migration_downgrade_restores_maintenance_requester_foreign_key() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        assert _ondelete(connection) is None
