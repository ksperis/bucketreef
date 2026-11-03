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
    / "alembic/versions/0229_s3_account_deletion_state.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "s3_account_deletion_state_migration",
        MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _s3_accounts_table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )


def test_upgrade_creates_durable_s3_account_deletion_state():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = _s3_accounts_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(accounts.insert().values(id=20))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_account_deletions "
                "(id, account_id, rgw_account_id, rgw_user_uid, rgw_tenant, "
                "storage_endpoint_id, iam_cleanup_completed, root_user_deleted, "
                "remote_account_deleted, created_at, updated_at) "
                "VALUES (1, 20, 'RGW1', 'rgw1-admin', '', 7, 1, 0, 0, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        row = connection.execute(
            sa.text(
                "SELECT account_id, rgw_account_id, rgw_user_uid, storage_endpoint_id, "
                "iam_cleanup_completed, root_user_deleted, remote_account_deleted "
                "FROM s3_account_deletions"
            )
        ).one()
        assert row == (20, "RGW1", "rgw1-admin", 7, 1, 0, 0)


def test_downgrade_rejects_pending_s3_account_deletions():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = _s3_accounts_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(accounts.insert().values(id=20))
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO s3_account_deletions "
                "(id, account_id, rgw_account_id, rgw_user_uid, rgw_tenant, "
                "storage_endpoint_id, iam_cleanup_completed, root_user_deleted, "
                "remote_account_deleted, created_at, updated_at) "
                "VALUES (1, 20, 'RGW1', 'rgw1-admin', '', 7, 1, 1, 1, "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )

        with pytest.raises(RuntimeError, match="Complete pending S3 account deletions"):
            migration.downgrade()
