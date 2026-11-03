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
    / "alembic/versions/0227_portal_iam_revocation_state.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "portal_iam_revocation_state_migration",
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


def test_upgrade_creates_user_deletion_safe_revocation_queue():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = _s3_accounts_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            accounts.insert().values(id=20)
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(
            sa.text(
                "INSERT INTO portal_iam_revocations "
                "(id, user_id, account_id, iam_user_id, iam_username, created_at) "
                "VALUES (1, 11, 20, 'iam-pending', 'portal-pending', CURRENT_TIMESTAMP)"
            )
        )
        row = connection.execute(
            sa.text(
                "SELECT user_id, account_id, iam_user_id, iam_username "
                "FROM portal_iam_revocations"
            )
        ).one()
        assert row == (11, 20, "iam-pending", "portal-pending")


def test_downgrade_rejects_pending_portal_iam_revocations():
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
                "INSERT INTO portal_iam_revocations "
                "(id, user_id, account_id, iam_user_id, iam_username, created_at) "
                "VALUES (1, 10, 20, 'iam-pending', 'portal-pending', CURRENT_TIMESTAMP)"
            )
        )

        with pytest.raises(RuntimeError, match="Complete pending Portal IAM user revocations"):
            migration.downgrade()
