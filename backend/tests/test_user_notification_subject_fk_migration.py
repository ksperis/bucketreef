# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


_SUBJECT_REFERENCES = {
    "storage_endpoint_id": "storage_endpoints",
    "s3_account_id": "s3_accounts",
    "s3_user_id": "s3_users",
}


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0265_user_notification_subject_foreign_keys.py"
    )
    spec = util.spec_from_file_location(
        "migration_0265_user_notification_subject_foreign_keys",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine) -> None:
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    targets = {
        table_name: sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
        )
        for table_name in _SUBJECT_REFERENCES.values()
    }
    sa.Table(
        "user_notifications",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=True),
        sa.Column("s3_account_id", sa.Integer(), nullable=True),
        sa.Column("s3_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], [users.c.id], ondelete="CASCADE"),
        *(
            sa.ForeignKeyConstraint([column_name], [targets[table_name].c.id])
            for column_name, table_name in _SUBJECT_REFERENCES.items()
        ),
    )
    metadata.create_all(engine)


def _ondelete(connection, column_name: str) -> str | None:
    foreign_key = next(
        item
        for item in sa.inspect(connection).get_foreign_keys("user_notifications")
        if item["constrained_columns"] == [column_name]
    )
    return foreign_key.get("options", {}).get("ondelete")


def test_migration_sets_notification_subject_foreign_keys_to_set_null() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        for column_name in _SUBJECT_REFERENCES:
            assert _ondelete(connection, column_name) == "SET NULL"
        assert _ondelete(connection, "user_id") == "CASCADE"


def test_migration_downgrade_restores_notification_subject_foreign_keys() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        for column_name in _SUBJECT_REFERENCES:
            assert _ondelete(connection, column_name) is None
        assert _ondelete(connection, "user_id") == "CASCADE"
