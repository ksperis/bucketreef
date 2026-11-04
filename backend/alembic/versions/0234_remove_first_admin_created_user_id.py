# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused first-admin created user reference.

Revision ID: 0234_remove_first_admin_created_user_id
Revises: 0233_remove_unused_oidc_link_session_metadata
Create Date: 2026-11-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0234_remove_first_admin_created_user_id"
down_revision = "0233_remove_unused_oidc_link_session_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    foreign_key = next(
        (
            foreign_key
            for foreign_key in sa.inspect(bind).get_foreign_keys("first_admin_bootstrap")
            if foreign_key.get("constrained_columns") == ["created_user_id"]
        ),
        None,
    )
    with op.batch_alter_table("first_admin_bootstrap", schema=None) as batch_op:
        if foreign_key and foreign_key.get("name"):
            batch_op.drop_constraint(str(foreign_key["name"]), type_="foreignkey")
        batch_op.drop_column("created_user_id")


def downgrade() -> None:
    with op.batch_alter_table("first_admin_bootstrap", schema=None) as batch_op:
        batch_op.add_column(sa.Column("created_user_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_first_admin_bootstrap_created_user_id_users",
            "users",
            ["created_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
