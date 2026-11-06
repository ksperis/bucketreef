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
        / "0243_remove_openstack_context_service_name.py"
    )
    spec = util.spec_from_file_location(
        "migration_0243_remove_openstack_context_service_name",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("openstack_project_contexts")
    }


def test_migration_removes_and_restores_unused_persisted_service_name(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    contexts = sa.Table(
        "openstack_project_contexts",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("region_id", sa.String(), nullable=False),
        sa.Column("service_type", sa.String(), nullable=False),
        sa.Column("service_name", sa.String(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            contexts.insert().values(
                id="context-a",
                region_id="RegionOne",
                service_type="s3",
                service_name="S3 API",
            )
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert "service_name" not in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT region_id, service_type "
                "FROM openstack_project_contexts WHERE id = 'context-a'"
            )
        ).one()
        assert tuple(row) == ("RegionOne", "s3")

        migration.downgrade()

        assert "service_name" in _column_names(connection)
        row = connection.execute(
            sa.text(
                "SELECT region_id, service_type, service_name "
                "FROM openstack_project_contexts WHERE id = 'context-a'"
            )
        ).one()
        assert tuple(row) == ("RegionOne", "s3", None)
