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
    / "alembic/versions/0228_s3_user_deletion_state.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "s3_user_deletion_state_migration",
        MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _s3_users_table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "s3_users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )


def test_upgrade_creates_durable_s3_user_deletion_state():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = _s3_users_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(users.insert().values(id=20))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_user_deletions "
                "(id, s3_user_id, mode, rgw_user_uid, rgw_tenant, access_key_id, "
                "remote_completed, created_at, updated_at) "
                "VALUES (1, 20, 'access_key', 'analyst', 'team-a', 'AK1', 0, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        row = connection.execute(
            sa.text(
                "SELECT s3_user_id, mode, rgw_user_uid, rgw_tenant, access_key_id, "
                "remote_completed FROM s3_user_deletions"
            )
        ).one()
        assert row == (20, "access_key", "analyst", "team-a", "AK1", 0)


def test_downgrade_rejects_pending_s3_user_deletions():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = _s3_users_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(users.insert().values(id=20))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_user_deletions "
                "(id, s3_user_id, mode, rgw_user_uid, rgw_tenant, access_key_id, "
                "remote_completed, created_at, updated_at) "
                "VALUES (1, 20, 'remote_user', 'analyst', '', NULL, 1, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )

        with pytest.raises(RuntimeError, match="Complete pending S3 user deletions"):
            migration.downgrade()
