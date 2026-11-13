# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0274_manager_browser_resource_access.py"
    )
    spec = util.spec_from_file_location("migration_0274_manager_browser_resource_access", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _schema(engine) -> tuple[sa.Table, sa.Table]:
    metadata = sa.MetaData()
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    users = sa.Table(
        "s3_users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    metadata.create_all(engine)
    return accounts, users


def test_migration_adds_nullable_resource_overrides_without_backfill():
    engine = sa.create_engine("sqlite:///:memory:")
    accounts, users = _schema(engine)

    with engine.begin() as connection:
        connection.execute(accounts.insert().values(id=1, name="account"))
        connection.execute(users.insert().values(id=2, name="user"))

        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        account_columns = {column["name"]: column for column in sa.inspect(connection).get_columns("s3_accounts")}
        user_columns = {column["name"]: column for column in sa.inspect(connection).get_columns("s3_users")}
        column_name = "allow_manager_browser_data_access_for_all_admins"

        assert account_columns[column_name]["nullable"] is True
        assert user_columns[column_name]["nullable"] is True
        assert connection.scalar(sa.text(f"SELECT {column_name} FROM s3_accounts WHERE id = 1")) is None
        assert connection.scalar(sa.text(f"SELECT {column_name} FROM s3_users WHERE id = 2")) is None

        migration.downgrade()
        assert column_name not in {
            column["name"] for column in sa.inspect(connection).get_columns("s3_accounts")
        }
        assert column_name not in {
            column["name"] for column in sa.inspect(connection).get_columns("s3_users")
        }
