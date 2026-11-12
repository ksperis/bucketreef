# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


_TABLES = (
    "cost_usage_daily",
    "cost_storage_daily",
    "quota_usage_hourly",
    "quota_usage_daily",
    "quota_alert_states",
)
_REFERENCES = {
    "storage_endpoint_id": "storage_endpoints",
    "s3_account_id": "s3_accounts",
    "s3_user_id": "s3_users",
}


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0266_cost_quota_resource_cascades.py"
    )
    spec = util.spec_from_file_location(
        "migration_0266_cost_quota_resource_cascades",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine) -> None:
    metadata = sa.MetaData()
    targets = {
        table_name: sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
        )
        for table_name in _REFERENCES.values()
    }
    for table_name in _TABLES:
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("storage_endpoint_id", sa.Integer(), nullable=False),
            sa.Column("s3_account_id", sa.Integer(), nullable=True),
            sa.Column("s3_user_id", sa.Integer(), nullable=True),
            *(
                sa.ForeignKeyConstraint([column_name], [targets[target_table].c.id])
                for column_name, target_table in _REFERENCES.items()
            ),
        )
    metadata.create_all(engine)


def _ondelete(connection, table_name: str, column_name: str) -> str | None:
    foreign_key = next(
        item
        for item in sa.inspect(connection).get_foreign_keys(table_name)
        if item["constrained_columns"] == [column_name]
    )
    return foreign_key.get("options", {}).get("ondelete")


def test_migration_sets_cost_and_quota_resource_foreign_keys_to_cascade() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        for table_name in _TABLES:
            for column_name in _REFERENCES:
                assert _ondelete(connection, table_name, column_name) == "CASCADE"


def test_migration_downgrade_restores_cost_and_quota_resource_foreign_keys() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        for table_name in _TABLES:
            for column_name in _REFERENCES:
                assert _ondelete(connection, table_name, column_name) is None
