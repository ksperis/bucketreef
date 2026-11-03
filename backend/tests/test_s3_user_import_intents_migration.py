# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/0230_s3_user_import_intents.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "s3_user_import_intents_migration",
        MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _storage_endpoints_table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )


def test_upgrade_creates_durable_s3_user_import_state():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(endpoints.insert().values(id=7))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_user_import_intents "
                "(id, storage_endpoint_id, rgw_user_uid, rgw_tenant, requested_name, "
                "requested_email, access_key_id, secret_access_key, phase, created_at, updated_at) "
                "VALUES (1, 7, 'analyst', 'team_a', 'Analyst', 'a@example.test', "
                "'AK1', 'encrypted-secret', 'creating', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        row = connection.execute(
            sa.text(
                "SELECT storage_endpoint_id, rgw_user_uid, rgw_tenant, access_key_id, phase "
                "FROM s3_user_import_intents"
            )
        ).one()
        assert row == (7, "analyst", "team_a", "AK1", "creating")


def test_downgrade_rejects_pending_s3_user_imports():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(endpoints.insert().values(id=7))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_user_import_intents "
                "(id, storage_endpoint_id, rgw_user_uid, rgw_tenant, access_key_id, "
                "secret_access_key, phase, created_at, updated_at) "
                "VALUES (1, 7, 'analyst', '', 'AK1', 'encrypted-secret', "
                "'remote_created', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )

        with pytest.raises(RuntimeError, match="Complete pending S3 user imports"):
            migration.downgrade()
