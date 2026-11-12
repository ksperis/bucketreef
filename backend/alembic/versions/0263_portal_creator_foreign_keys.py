# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Make retained Portal creator references nullable on user deletion.

Revision ID: 0263_portal_creator_foreign_keys
Revises: 0262_canonical_portal_storage_space_origin
Create Date: 2026-11-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0263_portal_creator_foreign_keys"
down_revision = "0262_canonical_portal_storage_space_origin"
branch_labels = None
depends_on = None


_TABLES = (
    "portal_storage_space_grants",
    "portal_public_links",
)
_COLUMN = "created_by_user_id"
_SQLITE_NAMING_CONVENTION = {
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
}


def _replace_creator_foreign_key(table_name: str, *, ondelete: str | None) -> None:
    bind = op.get_bind()
    foreign_key = next(
        (
            item
            for item in sa.inspect(bind).get_foreign_keys(table_name)
            if item.get("constrained_columns") == [_COLUMN]
        ),
        None,
    )
    if foreign_key is None:
        raise RuntimeError(f"Cannot locate {table_name}.{_COLUMN} foreign key")

    constraint_name = foreign_key.get("name")
    batch_kwargs: dict[str, object] = {"schema": None}
    if bind.dialect.name == "sqlite" and not constraint_name:
        batch_kwargs["naming_convention"] = _SQLITE_NAMING_CONVENTION
        constraint_name = f"fk_{table_name}_{_COLUMN}_users"
    if not constraint_name:
        raise RuntimeError(f"Cannot identify {table_name}.{_COLUMN} foreign key")

    canonical_name = f"fk_{table_name}_{_COLUMN}_users"
    with op.batch_alter_table(table_name, **batch_kwargs) as batch_op:
        batch_op.drop_constraint(str(constraint_name), type_="foreignkey")
        batch_op.create_foreign_key(
            canonical_name,
            "users",
            [_COLUMN],
            ["id"],
            ondelete=ondelete,
        )


def upgrade() -> None:
    for table_name in _TABLES:
        _replace_creator_foreign_key(table_name, ondelete="SET NULL")


def downgrade() -> None:
    for table_name in _TABLES:
        _replace_creator_foreign_key(table_name, ondelete=None)
