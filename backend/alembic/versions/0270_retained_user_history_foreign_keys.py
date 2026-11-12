# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Preserve retained user history through database foreign-key actions.

Revision ID: 0270_retained_user_history_foreign_keys
Revises: 0269_bucket_migration_child_cascades
Create Date: 2026-11-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0270_retained_user_history_foreign_keys"
down_revision = "0269_bucket_migration_child_cascades"
branch_labels = None
depends_on = None


_REFERENCES = (
    ("audit_logs", "user_id"),
    ("bucket_migrations", "created_by_user_id"),
)
_SQLITE_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _replace_user_foreign_key(
    table_name: str,
    column_name: str,
    *,
    ondelete: str | None,
) -> None:
    bind = op.get_bind()
    foreign_key = next(
        (
            item
            for item in sa.inspect(bind).get_foreign_keys(table_name)
            if item.get("constrained_columns") == [column_name]
        ),
        None,
    )
    if foreign_key is None:
        raise RuntimeError(f"Cannot locate {table_name}.{column_name} foreign key")

    constraint_name = foreign_key.get("name")
    batch_kwargs: dict[str, object] = {"schema": None}
    if bind.dialect.name == "sqlite" and not constraint_name:
        batch_kwargs["naming_convention"] = _SQLITE_NAMING_CONVENTION
        constraint_name = f"fk_{table_name}_{column_name}_users"
    if not constraint_name:
        raise RuntimeError(f"Cannot identify {table_name}.{column_name} foreign key")

    with op.batch_alter_table(table_name, **batch_kwargs) as batch_op:
        batch_op.drop_constraint(str(constraint_name), type_="foreignkey")
        batch_op.create_foreign_key(
            f"fk_{table_name}_{column_name}_users",
            "users",
            [column_name],
            ["id"],
            ondelete=ondelete,
        )


def upgrade() -> None:
    for table_name, column_name in _REFERENCES:
        _replace_user_foreign_key(table_name, column_name, ondelete="SET NULL")


def downgrade() -> None:
    for table_name, column_name in _REFERENCES:
        _replace_user_foreign_key(table_name, column_name, ondelete=None)
