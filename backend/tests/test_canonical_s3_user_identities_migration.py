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
