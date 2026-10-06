# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def test_migration_preserves_external_ceph_admin_credentials_while_enforcing_managed_mode(monkeypatch):
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0139_managed_ceph_admin_identity.py"
    spec = importlib.util.spec_from_file_location("managed_ceph_admin_identity_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
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
            INSERT INTO endpoint_service_identities
                (id, endpoint_id, kind, mode, rgw_uid, access_key, secret_key,
                 previous_access_key, provenance, status, last_error,
                 last_reconciled_at, created_at, updated_at)
            VALUES
                (1, 10, 'ceph_admin', 'external', 'legacy-admin', 'LEGACY-AK',
                 'encrypted-secret', 'OLD-AK', NULL, 'ready', 'legacy',
                 '2026-10-01 10:00:00', '2026-10-01 10:00:00', '2026-10-01 10:00:00'),
                (2, 10, 'runtime', 'external', 'runtime', 'RUN-AK',
                 'encrypted-runtime', NULL, NULL, 'ready', NULL, NULL,
                 '2026-10-01 10:00:00', '2026-10-01 10:00:00')
            """
        )
        monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))

        module.upgrade()

        ceph_admin = connection.execute(
            sa.text(
                "SELECT mode, rgw_uid, access_key, secret_key, previous_access_key, "
                "provenance, status, last_error, last_reconciled_at "
                "FROM endpoint_service_identities WHERE kind = 'ceph_admin'"
            )
        ).one()
        assert ceph_admin == (
            "managed",
            None,
            "LEGACY-AK",
            "encrypted-secret",
            None,
            None,
            "missing",
            None,
            None,
        )

        runtime = connection.execute(
            sa.text(
                "SELECT mode, access_key, secret_key, status "
                "FROM endpoint_service_identities WHERE kind = 'runtime'"
            )
        ).one()
        assert runtime == ("external", "RUN-AK", "encrypted-runtime", "ready")

        with pytest.raises(IntegrityError):
            connection.execute(
                sa.text(
                    "INSERT INTO endpoint_service_identities "
                    "(id, endpoint_id, kind, mode, status, created_at, updated_at) "
                    "VALUES (3, 11, 'ceph_admin', 'external', 'missing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
