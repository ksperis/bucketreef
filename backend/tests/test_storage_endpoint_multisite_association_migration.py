# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0194_storage_endpoint_multisite_association.py"
    )
    spec = util.spec_from_file_location(
        "migration_0194_storage_endpoint_multisite_association",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_adds_multisite_constraints_and_diagnostic_uniqueness(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    realm_id = "11111111-1111-1111-1111-111111111111"
    zonegroup_id = "22222222-2222-2222-2222-222222222222"
    zone_id = "33333333-3333-3333-3333-333333333333"

    with engine.begin() as connection:
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        inspector = sa.inspect(connection)
        assert {
            "multisite_realm_id",
            "multisite_zonegroup_id",
            "multisite_zone_id",
            "multisite_diagnostic",
        } <= {column["name"] for column in inspector.get_columns("storage_endpoints")}
        assert {
            "ck_storage_endpoints_multisite_association_complete",
            "ck_storage_endpoints_multisite_diagnostic_requires_zone",
            "ck_storage_endpoints_multisite_ceph_only",
        } <= {check["name"] for check in inspector.get_check_constraints("storage_endpoints")}
        diagnostic_index = next(
            index
            for index in inspector.get_indexes("storage_endpoints")
            if index["name"] == "uq_storage_endpoints_multisite_diagnostic_zone"
        )
        assert diagnostic_index["unique"] == 1
        assert diagnostic_index["column_names"] == [
            "multisite_realm_id",
            "multisite_zonegroup_id",
            "multisite_zone_id",
        ]

        insert_sql = sa.text(
            "INSERT INTO storage_endpoints "
            "(id, provider, multisite_realm_id, multisite_zonegroup_id, multisite_zone_id, multisite_diagnostic) "
            "VALUES (:id, :provider, :realm_id, :zonegroup_id, :zone_id, :diagnostic)"
        )
        connection.execute(
            insert_sql,
            {
                "id": 1,
                "provider": "ceph",
                "realm_id": realm_id,
                "zonegroup_id": zonegroup_id,
                "zone_id": zone_id,
                "diagnostic": True,
            },
        )
        connection.execute(
            insert_sql,
            {
                "id": 2,
                "provider": "ceph",
                "realm_id": realm_id,
                "zonegroup_id": zonegroup_id,
                "zone_id": zone_id,
                "diagnostic": False,
            },
        )

        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    insert_sql,
                    {
                        "id": 3,
                        "provider": "ceph",
                        "realm_id": realm_id,
                        "zonegroup_id": zonegroup_id,
                        "zone_id": zone_id,
                        "diagnostic": True,
                    },
                )

        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    insert_sql,
                    {
                        "id": 4,
                        "provider": "ceph",
                        "realm_id": None,
                        "zonegroup_id": None,
                        "zone_id": None,
                        "diagnostic": True,
                    },
                )

        migration.downgrade()
        inspector = sa.inspect(connection)
        assert all(
            not column["name"].startswith("multisite_")
            for column in inspector.get_columns("storage_endpoints")
        )
        assert all(
            index["name"] != "uq_storage_endpoints_multisite_diagnostic_zone"
            for index in inspector.get_indexes("storage_endpoints")
        )
