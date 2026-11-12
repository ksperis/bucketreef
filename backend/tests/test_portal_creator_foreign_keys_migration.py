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
        / "0263_portal_creator_foreign_keys.py"
    )
    spec = util.spec_from_file_location(
        "migration_0263_portal_creator_foreign_keys",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine) -> None:
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    for table_name in ("portal_storage_space_grants", "portal_public_links"):
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "created_by_user_id",
                sa.Integer(),
                sa.ForeignKey(users.c.id),
                nullable=True,
            ),
        )
    metadata.create_all(engine)


def _creator_ondelete(connection, table_name: str) -> str | None:
    foreign_key = next(
        item
        for item in sa.inspect(connection).get_foreign_keys(table_name)
        if item["constrained_columns"] == ["created_by_user_id"]
    )
    return foreign_key.get("options", {}).get("ondelete")


def test_migration_sets_portal_creator_foreign_keys_to_set_null() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        assert _creator_ondelete(connection, "portal_storage_space_grants") == "SET NULL"
        assert _creator_ondelete(connection, "portal_public_links") == "SET NULL"


def test_migration_downgrade_restores_portal_creator_foreign_keys() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        assert _creator_ondelete(connection, "portal_storage_space_grants") is None
        assert _creator_ondelete(connection, "portal_public_links") is None
