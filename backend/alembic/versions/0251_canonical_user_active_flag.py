# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Require a canonical active flag for UI users.

Revision ID: 0251_canonical_user_active_flag
Revises: 0250_remove_cost_by_bucket
Create Date: 2026-11-06
"""

from alembic import op
import sqlalchemy as sa


revision = "0251_canonical_user_active_flag"
down_revision = "0250_remove_cost_by_bucket"
branch_labels = None
depends_on = None


def upgrade() -> None:
    users = sa.table(
        "users",
        sa.column("is_active", sa.Boolean()),
    )
    op.execute(
        users.update()
        .where(users.c.is_active.is_(None))
        .values(is_active=False)
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.alter_column(
            "is_active",
            existing_type=sa.Boolean(),
            nullable=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.alter_column(
            "is_active",
            existing_type=sa.Boolean(),
            nullable=True,
        )
