# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util
from datetime import datetime, timezone
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/0147_remove_legacy_ceph_admin_system_compat.py"
    )
    spec = importlib.util.spec_from_file_location("remove_legacy_ceph_admin_system_compat", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_removes_legacy_compat_and_requires_revalidation():
    module = _load_migration()
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    identities = sa.Table(
        "endpoint_service_identities",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("kind", sa.String, nullable=False),
        sa.Column("access_key", sa.String),
        sa.Column("secret_key", sa.String),
        sa.Column("status", sa.String, nullable=False),
        sa.Column("last_error", sa.String),
        sa.Column("last_reconciled_at", sa.DateTime(timezone=True)),
        sa.Column("legacy_system_compat", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    metadata.create_all(engine)
    reconciled_at = datetime(2026, 10, 1, tzinfo=timezone.utc)

    with engine.begin() as connection:
        connection.execute(
            identities.insert(),
            [
                {
                    "id": 1,
                    "kind": "ceph_admin",
                    "access_key": "LEGACY-AK",
                    "secret_key": "LEGACY-SK",
                    "status": "ready",
                    "last_error": "old error",
                    "last_reconciled_at": reconciled_at,
                    "legacy_system_compat": True,
                },
                {
                    "id": 2,
                    "kind": "ceph_admin",
                    "access_key": "STRICT-AK",
                    "secret_key": "STRICT-SK",
                    "status": "ready",
                    "last_error": None,
                    "last_reconciled_at": reconciled_at,
                    "legacy_system_compat": False,
                },
            ],
        )
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("endpoint_service_identities")}
        assert "legacy_system_compat" not in columns
        rows = connection.execute(
            sa.text(
                "SELECT id, status, last_error, last_reconciled_at "
                "FROM endpoint_service_identities ORDER BY id"
            )
        ).mappings().all()
        assert rows[0]["status"] == "missing"
        assert rows[0]["last_error"] is None
        assert rows[0]["last_reconciled_at"] is None
        assert rows[1]["status"] == "ready"

        module.downgrade()
        restored_columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("endpoint_service_identities")
        }
        assert "legacy_system_compat" in restored_columns
        restored = connection.execute(
            sa.text(
                "SELECT id, legacy_system_compat FROM endpoint_service_identities ORDER BY id"
            )
        ).mappings().all()
        assert [bool(row["legacy_system_compat"]) for row in restored] == [True, True]

    engine.dispose()
