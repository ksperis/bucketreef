# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Remove unused OIDC link session metadata.

Revision ID: 0233_remove_unused_oidc_link_session_metadata
Revises: 0232_remove_oidc_issuer_pin_timestamps
Create Date: 2026-11-04
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0233_remove_unused_oidc_link_session_metadata"
down_revision = "0232_remove_oidc_issuer_pin_timestamps"
branch_labels = None
depends_on = None


def _drop_column_dependencies(table_name: str, column_name: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    indexes = {
        index["name"]
        for index in inspector.get_indexes(table_name)
        if index.get("column_names") == [column_name] and index.get("name")
    }
    foreign_key = next(
        (
            foreign_key
            for foreign_key in inspector.get_foreign_keys(table_name)
            if foreign_key.get("constrained_columns") == [column_name]
        ),
        None,
    )

    with op.batch_alter_table(table_name, schema=None) as batch_op:
        for index_name in sorted(indexes):
            batch_op.drop_index(index_name)
        if foreign_key and foreign_key.get("name"):
            batch_op.drop_constraint(str(foreign_key["name"]), type_="foreignkey")
        batch_op.drop_column(column_name)


def upgrade() -> None:
    _drop_column_dependencies(
        "external_identity_link_attempts",
        "initiating_auth_session_id",
    )
    _drop_column_dependencies("oidc_login_states", "target_user_id")
    _drop_column_dependencies("oidc_login_states", "auth_session_id")


def downgrade() -> None:
    with op.batch_alter_table("external_identity_link_attempts", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("initiating_auth_session_id", sa.String(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_external_identity_link_attempts_initiating_auth_session_id_auth_sessions",
            "auth_sessions",
            ["initiating_auth_session_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_external_identity_link_attempts_initiating_auth_session_id",
            ["initiating_auth_session_id"],
            unique=False,
        )

    with op.batch_alter_table("oidc_login_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("target_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("auth_session_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_oidc_login_states_target_user_id_users",
            "users",
            ["target_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_oidc_login_states_auth_session_id_auth_sessions",
            "auth_sessions",
            ["auth_session_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_oidc_login_states_target_user_id",
            ["target_user_id"],
            unique=False,
        )
        batch_op.create_index(
            "ix_oidc_login_states_auth_session_id",
            ["auth_session_id"],
            unique=False,
        )
