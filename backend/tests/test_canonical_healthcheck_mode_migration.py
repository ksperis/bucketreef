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
        / "0252_canonical_healthcheck_mode.py"
    )
    spec = util.spec_from_file_location(
        "migration_0252_canonical_healthcheck_mode",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_modes_and_enforces_constraints():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tables = {
        table_name: sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("check_mode", sa.String(), nullable=False),
        )
        for table_name in (
            "endpoint_health_checks",
            "endpoint_health_latest",
            "endpoint_health_status_segments",
            "endpoint_health_rollups",
        )
    }
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        for table in tables.values():
            connection.execute(
                table.insert(),
                [
                    {"id": 1, "check_mode": "http"},
                    {"id": 2, "check_mode": " S3 "},
                    {"id": 3, "check_mode": "legacy"},
                ],
            )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        inspector = sa.inspect(connection)
        for table_name, table in tables.items():
            assert connection.execute(
                sa.select(table.c.id, table.c.check_mode).order_by(table.c.id)
            ).all() == [(1, "http"), (2, "s3"), (3, "http")]
            constraints = {
                item["name"]
                for item in inspector.get_check_constraints(table_name)
            }
            assert migration._TABLE_CONSTRAINTS[table_name] in constraints
            with pytest.raises(sa.exc.IntegrityError):
                connection.execute(
                    table.insert().values(id=4, check_mode="invalid")
                )
