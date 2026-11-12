# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


_REFERENCES = (
    ("api_tokens", "user_id", "users"),
    ("user_s3_accounts", "user_id", "users"),
    ("user_s3_accounts", "account_id", "s3_accounts"),
    ("user_s3_users", "user_id", "users"),
    ("user_s3_users", "s3_user_id", "s3_users"),
    ("user_s3_connections", "user_id", "users"),
    ("user_s3_connections", "s3_connection_id", "s3_connections"),
    ("user_ui_groups", "user_id", "users"),
    ("user_ui_groups", "group_id", "ui_groups"),
    ("ui_group_s3_accounts", "group_id", "ui_groups"),
    ("ui_group_s3_accounts", "account_id", "s3_accounts"),
    ("ui_group_s3_users", "group_id", "ui_groups"),
    ("ui_group_s3_users", "s3_user_id", "s3_users"),
    ("ui_group_s3_connections", "group_id", "ui_groups"),
    ("ui_group_s3_connections", "s3_connection_id", "s3_connections"),
)


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0268_association_resource_cascades.py"
    )
    spec = util.spec_from_file_location(
        "migration_0268_association_resource_cascades",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_legacy_schema(engine) -> None:
    metadata = sa.MetaData()
    parent_names = sorted({target for _, _, target in _REFERENCES})
    parents = {
        table_name: sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
        )
        for table_name in parent_names
    }
    children: dict[str, list[tuple[str, str]]] = {}
    for table_name, column_name, target_table in _REFERENCES:
        children.setdefault(table_name, []).append((column_name, target_table))
    for table_name, references in children.items():
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.Integer(), primary_key=True),
            *(
                sa.Column(column_name, sa.Integer(), nullable=False)
                for column_name, _ in references
            ),
            *(
                sa.ForeignKeyConstraint([column_name], [parents[target_table].c.id])
                for column_name, target_table in references
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


def test_migration_sets_association_foreign_keys_to_cascade() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        for table_name, column_name, _ in _REFERENCES:
            assert _ondelete(connection, table_name, column_name) == "CASCADE"


def test_migration_downgrade_restores_association_foreign_keys() -> None:
    engine = sa.create_engine("sqlite:///:memory:")
    _create_legacy_schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        migration.downgrade()

        for table_name, column_name, _ in _REFERENCES:
            assert _ondelete(connection, table_name, column_name) is None
