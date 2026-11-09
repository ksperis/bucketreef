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
        / "0262_canonical_portal_storage_space_origin.py"
    )
    spec = util.spec_from_file_location(
        "migration_0262_canonical_portal_storage_space_origin",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_table(engine) -> sa.Table:
    metadata = sa.MetaData()
    table = sa.Table(
        "portal_storage_space_metadata",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("origin", sa.String(), nullable=True),
    )
    metadata.create_all(engine)
    return table


def test_migration_canonicalizes_unsupported_origins_and_enforces_constraint() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    table = _create_table(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            table.insert(),
            [
                {"id": 1, "origin": "portal_generic"},
                {"id": 2, "origin": "portal_named"},
                {"id": 3, "origin": "imported"},
                {"id": 4, "origin": "legacy"},
                {"id": 5, "origin": ""},
                {"id": 6, "origin": "custom"},
                {"id": 7, "origin": None},
            ],
        )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        origins = {
            row.id: row.origin
            for row in connection.execute(sa.select(table.c.id, table.c.origin))
        }
        assert origins == {
            1: "portal_generic",
            2: "portal_named",
            3: "imported",
            4: "imported",
            5: "imported",
            6: "imported",
            7: "imported",
        }
        constraints = {
            item["name"]
            for item in sa.inspect(connection).get_check_constraints(
                "portal_storage_space_metadata"
            )
        }
        assert migration._CONSTRAINT_NAME in constraints
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(table.insert().values(id=8, origin="unsupported"))


def test_migration_downgrade_removes_origin_constraint() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    table = _create_table(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        connection.execute(table.insert().values(id=1, origin="legacy"))
        assert connection.scalar(sa.select(table.c.origin)) == "legacy"
