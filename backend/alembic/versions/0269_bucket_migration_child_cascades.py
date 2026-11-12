# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Cascade migration items and events with their parent migration.

Revision ID: 0269_bucket_migration_child_cascades
Revises: 0268_association_resource_cascades
Create Date: 2026-11-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0269_bucket_migration_child_cascades"
down_revision = "0268_association_resource_cascades"
branch_labels = None
depends_on = None


_TABLES = (
    "bucket_migration_items",
    "bucket_migration_events",
)
_SQLITE_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _replace_migration_foreign_key(
    table_name: str,
    *,
    ondelete: str | None,
) -> None:
    bind = op.get_bind()
    foreign_key = next(
        (
            item
            for item in sa.inspect(bind).get_foreign_keys(table_name)
            if item.get("constrained_columns") == ["migration_id"]
        ),
        None,
    )
    if foreign_key is None:
        raise RuntimeError(f"Cannot locate {table_name}.migration_id foreign key")

    constraint_name = foreign_key.get("name")
    use_sqlite_naming_convention = bind.dialect.name == "sqlite" and not constraint_name
    if use_sqlite_naming_convention:
        constraint_name = f"fk_{table_name}_migration_id_bucket_migrations"
    if not constraint_name:
        raise RuntimeError(f"Cannot identify {table_name}.migration_id foreign key")

    batch_kwargs: dict[str, object] = {"schema": None}
    if use_sqlite_naming_convention:
        batch_kwargs["naming_convention"] = _SQLITE_NAMING_CONVENTION

    with op.batch_alter_table(table_name, **batch_kwargs) as batch_op:
        batch_op.drop_constraint(str(constraint_name), type_="foreignkey")
        batch_op.create_foreign_key(
            f"fk_{table_name}_migration_id_bucket_migrations",
            "bucket_migrations",
            ["migration_id"],
            ["id"],
            ondelete=ondelete,
        )


def upgrade() -> None:
    for table_name in _TABLES:
        _replace_migration_foreign_key(table_name, ondelete="CASCADE")


def downgrade() -> None:
    for table_name in _TABLES:
        _replace_migration_foreign_key(table_name, ondelete=None)
