# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_migration_moves_endpoint_mode_to_runtime_identity_and_restores_it_on_downgrade(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0140_runtime_identity_mode_source.py"
    spec = importlib.util.spec_from_file_location("runtime_identity_mode_source_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql(
            """
            CREATE TABLE storage_endpoints (
                id INTEGER PRIMARY KEY,
                provider VARCHAR NOT NULL,
                service_identity_mode VARCHAR(16) NOT NULL DEFAULT 'managed'
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE endpoint_service_identities (
                id INTEGER PRIMARY KEY,
                endpoint_id INTEGER NOT NULL,
                kind VARCHAR(24) NOT NULL,
                mode VARCHAR(16) NOT NULL,
                rgw_uid VARCHAR(128),
                access_key VARCHAR,
                secret_key VARCHAR,
                previous_access_key VARCHAR,
                provenance VARCHAR(128),
                status VARCHAR(24) NOT NULL,
                last_error VARCHAR(256),
                last_reconciled_at DATETIME,
                created_at DATETIME NOT NULL,
                updated_at DATETIME NOT NULL
            )
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO storage_endpoints (id, provider, service_identity_mode)
            VALUES
                (1, 'ceph', 'external'),
                (2, 'ceph', 'managed'),
                (3, 'aws', 'external')
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO endpoint_service_identities
                (id, endpoint_id, kind, mode, status, created_at, updated_at)
            VALUES
                (10, 2, 'runtime', 'external', 'ready', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        )
        monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))

        module.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("storage_endpoints")}
        assert "service_identity_mode" not in columns
        runtime_rows = connection.execute(
            sa.text(
                "SELECT endpoint_id, mode, status FROM endpoint_service_identities "
                "WHERE kind = 'runtime' ORDER BY endpoint_id"
            )
        ).all()
        assert runtime_rows == [(1, "external", "missing"), (2, "external", "ready")]

        module.downgrade()

        modes = connection.execute(
            sa.text("SELECT id, service_identity_mode FROM storage_endpoints ORDER BY id")
        ).all()
        assert modes == [(1, "external"), (2, "external"), (3, "managed")]
