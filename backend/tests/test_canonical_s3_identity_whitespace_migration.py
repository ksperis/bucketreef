# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0127_canonical_s3_identity_whitespace.py"
    )
    spec = util.spec_from_file_location(
        "migration_0127_canonical_s3_identity_whitespace",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rgw_account_id", sa.String(), nullable=False, unique=True),
        sa.Column("rgw_user_uid", sa.String(), nullable=False),
        sa.CheckConstraint(
            "TRIM(rgw_account_id) <> ''",
            name="ck_s3_accounts_rgw_account_id_nonempty",
        ),
        sa.CheckConstraint(
            "TRIM(rgw_user_uid) <> ''",
            name="ck_s3_accounts_rgw_user_uid_nonempty",
        ),
    )
    users = sa.Table(
        "s3_users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rgw_user_uid", sa.String(), nullable=False),
        sa.UniqueConstraint("rgw_user_uid", name="uq_s3_users_uid"),
        sa.CheckConstraint(
            "TRIM(rgw_user_uid) <> ''",
            name="ck_s3_users_rgw_user_uid_nonempty",
        ),
    )
    metadata.create_all(engine)
    return accounts, users


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def test_migration_trims_existing_identities_and_enforces_canonical_whitespace(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    accounts, users = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert().values(
                id=1,
                name="account",
                rgw_account_id="  RgW Account 01  ",
                rgw_user_uid="  Root User + Case  ",
            )
        )
        connection.execute(
            users.insert().values(
                id=1,
                name="user",
                rgw_user_uid="  User + Case  ",
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        account_identity = connection.execute(
            sa.select(accounts.c.rgw_account_id, accounts.c.rgw_user_uid).where(accounts.c.id == 1)
        ).one()
        assert account_identity == ("RgW Account 01", "Root User + Case")
        assert connection.scalar(
            sa.select(users.c.rgw_user_uid).where(users.c.id == 1)
        ) == "User + Case"

        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    accounts.insert().values(
                        id=2,
                        name="non-canonical-account",
                        rgw_account_id=" RGW0002",
                        rgw_user_uid="root-2",
                    )
                )
        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    users.insert().values(
                        id=2,
                        name="non-canonical-user",
                        rgw_user_uid="user-2 ",
                    )
                )

        migration.downgrade()

        connection.execute(
            accounts.insert().values(
                id=3,
                name="legacy-account",
                rgw_account_id=" legacy-account ",
                rgw_user_uid=" legacy-root ",
            )
        )
        connection.execute(
            users.insert().values(
                id=3,
                name="legacy-user",
                rgw_user_uid=" legacy-user ",
            )
        )


def test_migration_rejects_account_id_trim_collisions_before_updating(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    accounts, _users = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert(),
            [
                {
                    "id": 1,
                    "name": "first",
                    "rgw_account_id": "RGW0001",
                    "rgw_user_uid": "root-1",
                },
                {
                    "id": 2,
                    "name": "second",
                    "rgw_account_id": " RGW0001 ",
                    "rgw_user_uid": "root-2",
                },
            ],
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="s3_accounts.rgw_account_id"):
            migration.upgrade()

        assert connection.scalar(
            sa.select(accounts.c.rgw_account_id).where(accounts.c.id == 2)
        ) == " RGW0001 "


def test_migration_rejects_s3_user_uid_trim_collisions_before_updating(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    _accounts, users = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [
                {"id": 1, "name": "first", "rgw_user_uid": "user-1"},
                {"id": 2, "name": "second", "rgw_user_uid": " user-1 "},
            ],
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="s3_users.rgw_user_uid"):
            migration.upgrade()

        assert connection.scalar(
            sa.select(users.c.rgw_user_uid).where(users.c.id == 2)
        ) == " user-1 "


@pytest.mark.parametrize("table_name", ["s3_accounts", "s3_users"])
def test_migration_discards_stale_sqlite_batch_copy_when_source_table_is_intact(
    monkeypatch,
    table_name,
):
    engine = sa.create_engine("sqlite:///:memory:")
    accounts, users = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert().values(
                id=1,
                name="account",
                rgw_account_id="RGW0001",
                rgw_user_uid="root-1",
            )
        )
        connection.execute(users.insert().values(id=1, name="user", rgw_user_uid="user-1"))
        connection.exec_driver_sql(
            f'CREATE TABLE "_alembic_tmp_{table_name}" AS SELECT * FROM "{table_name}"'
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        assert f"_alembic_tmp_{table_name}" not in sa.inspect(connection).get_table_names()


@pytest.mark.parametrize("table_name", ["s3_accounts", "s3_users"])
def test_migration_refuses_ambiguous_stale_sqlite_batch_copy(monkeypatch, table_name):
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        connection.exec_driver_sql(
            f'CREATE TABLE "_alembic_tmp_{table_name}" (id INTEGER PRIMARY KEY)'
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match=f"{table_name} is missing"):
            migration.upgrade()
