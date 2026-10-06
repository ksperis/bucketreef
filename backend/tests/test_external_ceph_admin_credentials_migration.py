# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.mark.parametrize("dialect", ["sqlite", "postgresql"])
def test_ceph_admin_cutover_erases_only_ceph_admin_state(monkeypatch, dialect):
    url = "sqlite:///:memory:" if dialect == "sqlite" else os.getenv("BUCKETREEF_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("BUCKETREEF_TEST_POSTGRES_URL is not set for an isolated PostgreSQL database")
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0143_external_ceph_admin_credentials.py"
    spec = importlib.util.spec_from_file_location("external_ceph_admin_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine(url)
    schema = "ceph_manual_test_" + uuid4().hex
    try:
        with engine.begin() as connection:
            if dialect == "postgresql":
                connection.exec_driver_sql(f"CREATE SCHEMA {schema}")
                connection.exec_driver_sql(f"SET search_path TO {schema}")
            metadata = sa.MetaData()
            endpoints = sa.Table("storage_endpoints", metadata,
                sa.Column("id", sa.Integer, primary_key=True), sa.Column("ceph_admin_allowed", sa.Boolean))
            identities = sa.Table("endpoint_service_identities", metadata,
                sa.Column("id", sa.Integer, primary_key=True), sa.Column("kind", sa.String),
                sa.Column("mode", sa.String), sa.Column("rgw_uid", sa.String),
                sa.Column("access_key", sa.String), sa.Column("secret_key", sa.String),
                sa.Column("provenance", sa.String), sa.Column("status", sa.String),
                sa.Column("last_error", sa.String), sa.Column("last_reconciled_at", sa.DateTime),
                sa.CheckConstraint("kind != 'ceph_admin' OR mode = 'managed'",
                    name="ck_endpoint_service_identity_ceph_admin_managed"))
            intents = sa.Table("key_rotation_intents", metadata,
                sa.Column("id", sa.Integer, primary_key=True), sa.Column("key_type", sa.String),
                sa.Column("new_secret_key", sa.String), sa.Column("phase", sa.String))
            metadata.create_all(connection)
            connection.execute(endpoints.insert().values(id=1, ceph_admin_allowed=True))
            connection.execute(identities.insert(), [dict(id=i, kind=kind, mode="managed", rgw_uid="old-uid",
                access_key="old-key", secret_key="encrypted-old-secret", provenance="old-proof", status=status,
                last_error="old-error") for i, kind, status in [(1, "ceph_admin", "ready"), (2, "ceph_admin", "error"), (3, "runtime", "ready"), (4, "supervision", "ready")]])
            connection.execute(intents.insert(), [dict(id=1, key_type="ceph_admin", phase="prepared", new_secret_key="ceph-cipher"),
                dict(id=2, key_type="endpoint_runtime", phase="activated", new_secret_key="runtime-cipher")])
            monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
            module.upgrade()
            rows = connection.execute(sa.select(identities).order_by(identities.c.id)).mappings().all()
            for row in rows[:2]:
                assert row["mode"] == "external" and row["status"] == "missing"
                assert all(row[field] is None for field in ["rgw_uid", "access_key", "secret_key", "provenance", "last_error", "last_reconciled_at"])
            assert all(row["secret_key"] == "encrypted-old-secret" and row["mode"] == "managed" for row in rows[2:])
            assert connection.execute(sa.select(endpoints.c.ceph_admin_allowed)).scalar_one() is True
            remaining = connection.execute(sa.select(intents)).mappings().one()
            assert remaining["key_type"] == "endpoint_runtime" and remaining["new_secret_key"] == "runtime-cipher"
            constraints = sa.inspect(connection).get_check_constraints("endpoint_service_identities")
            assert any(c["name"] == "ck_endpoint_service_identity_ceph_admin_external" for c in constraints)
            module.downgrade()
            assert connection.execute(sa.select(identities.c.mode).where(identities.c.id == 1)).scalar_one() == "managed"
            assert connection.execute(sa.select(identities.c.secret_key).where(identities.c.id == 1)).scalar_one() is None
    finally:
        if dialect == "postgresql":
            with engine.begin() as connection:
                connection.exec_driver_sql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        engine.dispose()
