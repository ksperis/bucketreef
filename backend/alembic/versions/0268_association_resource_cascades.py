# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Cascade pure association rows and API tokens with their parent resources.

Revision ID: 0268_association_resource_cascades
Revises: 0267_endpoint_health_resource_cascades
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections import defaultdict

from alembic import op
import sqlalchemy as sa


revision = "0268_association_resource_cascades"
down_revision = "0267_endpoint_health_resource_cascades"
branch_labels = None
depends_on = None


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
_SQLITE_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _references_by_table() -> dict[str, list[tuple[str, str]]]:
    grouped: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for table_name, column_name, referred_table in _REFERENCES:
        grouped[table_name].append((column_name, referred_table))
    return grouped


def _replace_foreign_keys(
    table_name: str,
    references: list[tuple[str, str]],
    *,
    ondelete: str | None,
) -> None:
    bind = op.get_bind()
    foreign_keys = sa.inspect(bind).get_foreign_keys(table_name)
    replacements: list[tuple[str, str, str]] = []
    use_sqlite_naming_convention = False

    for column_name, referred_table in references:
        foreign_key = next(
            (
                item
                for item in foreign_keys
                if item.get("constrained_columns") == [column_name]
            ),
            None,
        )
        if foreign_key is None:
            raise RuntimeError(f"Cannot locate {table_name}.{column_name} foreign key")

        constraint_name = foreign_key.get("name")
        if bind.dialect.name == "sqlite" and not constraint_name:
            use_sqlite_naming_convention = True
            constraint_name = f"fk_{table_name}_{column_name}_{referred_table}"
        if not constraint_name:
            raise RuntimeError(f"Cannot identify {table_name}.{column_name} foreign key")
        replacements.append((column_name, referred_table, str(constraint_name)))

    batch_kwargs: dict[str, object] = {"schema": None}
    if use_sqlite_naming_convention:
        batch_kwargs["naming_convention"] = _SQLITE_NAMING_CONVENTION

    with op.batch_alter_table(table_name, **batch_kwargs) as batch_op:
        for column_name, referred_table, constraint_name in replacements:
            batch_op.drop_constraint(constraint_name, type_="foreignkey")
            batch_op.create_foreign_key(
                f"fk_{table_name}_{column_name}_{referred_table}",
                referred_table,
                [column_name],
                ["id"],
                ondelete=ondelete,
            )


def upgrade() -> None:
    for table_name, references in _references_by_table().items():
        _replace_foreign_keys(table_name, references, ondelete="CASCADE")


def downgrade() -> None:
    for table_name, references in _references_by_table().items():
        _replace_foreign_keys(table_name, references, ondelete=None)
