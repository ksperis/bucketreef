# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_migration_moves_encrypted_legacy_keys_and_keeps_authorization_disabled(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0138_endpoint_service_identities.py"
    spec = importlib.util.spec_from_file_location("service_identity_migration", path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE storage_endpoints (id INTEGER PRIMARY KEY, supervision_access_key TEXT, supervision_secret_key TEXT, ceph_admin_access_key TEXT, ceph_admin_secret_key TEXT)")
        connection.exec_driver_sql("INSERT INTO storage_endpoints VALUES (1, 'SUP', 'encrypted-sup', 'CEPH', 'encrypted-ceph'), (2, NULL, NULL, NULL, NULL)")
        monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
        module.upgrade()
        rows = connection.execute(sa.text("SELECT kind,mode,access_key,secret_key,provenance FROM endpoint_service_identities ORDER BY kind")).all()
        assert rows == [("ceph_admin", "external", "CEPH", "encrypted-ceph", None), ("supervision", "external", "SUP", "encrypted-sup", None)]
        endpoints = connection.execute(sa.text("SELECT identity_namespace,service_identity_mode,ceph_admin_allowed FROM storage_endpoints")).all()
        assert len({row[0] for row in endpoints}) == 2
        assert all(row[1:] == ("external", 0) for row in endpoints)
        columns = {column["name"] for column in sa.inspect(connection).get_columns("storage_endpoints")}
        assert "supervision_secret_key" not in columns and "ceph_admin_secret_key" not in columns
