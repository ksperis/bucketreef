# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration(filename: str, module_name: str):
    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / filename
    spec = util.spec_from_file_location(module_name, path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_0195_removes_and_downgrade_restores_multisite_association(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    migration_0194 = _load_migration(
        "0194_storage_endpoint_multisite_association.py",
        "migration_0194_storage_endpoint_multisite_association_for_0195",
    )
    migration_0195 = _load_migration(
        "0195_remove_storage_endpoint_multisite_association.py",
        "migration_0195_remove_storage_endpoint_multisite_association",
    )

    with engine.begin() as connection:
        operations = Operations(MigrationContext.configure(connection))
        monkeypatch.setattr(migration_0194, "op", operations)
        monkeypatch.setattr(migration_0195, "op", operations)
        migration_0194.upgrade()

        migration_0195.upgrade()
        inspector = sa.inspect(connection)
        assert all(
            not column["name"].startswith("multisite_")
            for column in inspector.get_columns("storage_endpoints")
        )
        assert all(
            "multisite" not in (check["name"] or "")
            for check in inspector.get_check_constraints("storage_endpoints")
        )
        assert all(
            index["name"] != "uq_storage_endpoints_multisite_diagnostic_zone"
            for index in inspector.get_indexes("storage_endpoints")
        )

        migration_0195.downgrade()
        inspector = sa.inspect(connection)
        assert {
            "multisite_realm_id",
            "multisite_zonegroup_id",
            "multisite_zone_id",
            "multisite_diagnostic",
        } <= {
            column["name"]
            for column in inspector.get_columns("storage_endpoints")
        }
        assert {
            "ck_storage_endpoints_multisite_association_complete",
            "ck_storage_endpoints_multisite_diagnostic_requires_zone",
            "ck_storage_endpoints_multisite_ceph_only",
        } <= {
            check["name"]
            for check in inspector.get_check_constraints("storage_endpoints")
        }
        assert any(
            index["name"] == "uq_storage_endpoints_multisite_diagnostic_zone"
            for index in inspector.get_indexes("storage_endpoints")
        )
