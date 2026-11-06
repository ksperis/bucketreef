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
        / "0253_canonical_healthcheck_dimensions.py"
    )
    spec = util.spec_from_file_location(
        "migration_0253_canonical_healthcheck_dimensions",
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
            sa.Column("check_type", sa.String(), nullable=False),
            sa.Column("scope", sa.String(), nullable=False),
        )
        for table_name in (
            "endpoint_health_latest",
            "endpoint_health_status_segments",
            "endpoint_health_rollups",
        )
    }
    metadata.create_all(engine)
    return tables


def test_migration_canonicalizes_dimensions_and_enforces_constraints():
    engine = sa.create_engine("sqlite:///:memory:")
    tables = _create_tables(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        for table in tables.values():
            connection.execute(
                table.insert().values(
                    id=1,
                    check_type=" Availability ",
                    scope=" ENDPOINT ",
                )
            )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        inspector = sa.inspect(connection)
        for table_name, table in tables.items():
            row = connection.execute(
                sa.select(table.c.check_type, table.c.scope)
            ).one()
            assert row == ("availability", "endpoint")
            constraints = {
                item["name"]
                for item in inspector.get_check_constraints(table_name)
            }
            assert migration._TABLE_CONSTRAINTS[table_name] in constraints
            with pytest.raises(sa.exc.IntegrityError):
                connection.execute(
                    table.insert().values(
                        id=2,
                        check_type="availability",
                        scope="bucket",
                    )
                )


def test_migration_rejects_unknown_dimensions():
    engine = sa.create_engine("sqlite:///:memory:")
    tables = _create_tables(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            tables["endpoint_health_latest"].insert().values(
                id=1,
                check_type="probe",
                scope="endpoint",
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(RuntimeError, match="Unsupported healthcheck dimensions"):
            migration.upgrade()
