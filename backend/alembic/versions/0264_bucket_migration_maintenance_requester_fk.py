# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Preserve bucket migrations when a maintenance requester is deleted.

Revision ID: 0264_bucket_migration_maintenance_requester_fk
Revises: 0263_portal_creator_foreign_keys
Create Date: 2026-11-12
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0264_bucket_migration_maintenance_requester_fk"
down_revision = "0263_portal_creator_foreign_keys"
branch_labels = None
depends_on = None


_TABLE = "bucket_migrations"
_COLUMN = "maintenance_requested_by_user_id"
_CONSTRAINT = "fk_bucket_migrations_maintenance_user"


def _replace_foreign_key(*, ondelete: str | None) -> None:
    bind = op.get_bind()
    foreign_key = next(
        (
            item
            for item in sa.inspect(bind).get_foreign_keys(_TABLE)
            if item.get("constrained_columns") == [_COLUMN]
        ),
        None,
    )
    if foreign_key is None:
        raise RuntimeError(f"Cannot locate {_TABLE}.{_COLUMN} foreign key")
    constraint_name = foreign_key.get("name")
    if not constraint_name:
        raise RuntimeError(f"Cannot identify {_TABLE}.{_COLUMN} foreign key")

    with op.batch_alter_table(_TABLE, schema=None) as batch_op:
        batch_op.drop_constraint(str(constraint_name), type_="foreignkey")
        batch_op.create_foreign_key(
            _CONSTRAINT,
            "users",
            [_COLUMN],
            ["id"],
            ondelete=ondelete,
        )


def upgrade() -> None:
    _replace_foreign_key(ondelete="SET NULL")


def downgrade() -> None:
    _replace_foreign_key(ondelete=None)
