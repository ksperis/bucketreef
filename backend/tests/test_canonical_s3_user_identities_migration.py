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
        / "0126_canonical_s3_user_identities.py"
    )
    spec = util.spec_from_file_location(
        "migration_0126_canonical_s3_user_identities",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    users = sa.Table(
        "s3_users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rgw_user_uid", sa.String(), nullable=False),
    )
    metadata.create_all(engine)
    return users


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def test_migration_enforces_nonempty_rgw_user_uid(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    users = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert().values(id=1, name="canonical", rgw_user_uid="canonical-user")
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        with pytest.raises(IntegrityError):
            with connection.begin_nested():
                connection.execute(
                    users.insert().values(id=2, name="blank", rgw_user_uid="  ")
                )

        migration.downgrade()
        connection.execute(
            users.insert().values(id=3, name="legacy", rgw_user_uid="  ")
        )


def test_migration_rejects_existing_empty_rgw_user_uid(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    users = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert().values(id=7, name="incomplete", rgw_user_uid="  ")
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="Repair rgw_user_uid before upgrading"):
            migration.upgrade()


def test_migration_discards_stale_sqlite_batch_copy_when_source_table_is_intact(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    users = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert().values(id=1, name="canonical", rgw_user_uid="canonical-user")
        )
        connection.exec_driver_sql(
            "CREATE TABLE _alembic_tmp_s3_users AS SELECT * FROM s3_users"
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        assert "_alembic_tmp_s3_users" not in sa.inspect(connection).get_table_names()
        assert connection.scalar(sa.select(sa.func.count()).select_from(users)) == 1


def test_migration_refuses_ambiguous_stale_sqlite_batch_copy(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE _alembic_tmp_s3_users "
            "(id INTEGER PRIMARY KEY, name VARCHAR NOT NULL, rgw_user_uid VARCHAR NOT NULL)"
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="s3_users is missing"):
            migration.upgrade()
