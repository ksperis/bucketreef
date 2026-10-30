# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Generalize secure account-link attempts for all external identities.

Revision ID: 0222_external_identity_link_attempts
Revises: 0221_identity_link_request_context
Create Date: 2026-10-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0222_external_identity_link_attempts"
down_revision = "0221_identity_link_request_context"
branch_labels = None
depends_on = None


_INDEX_COLUMNS = (
    "user_id",
    "initiating_auth_session_id",
    "existing_identity_id",
    "status",
    "expires_at",
    "consumed_at",
)


def _drop_login_state_foreign_key() -> None:
    bind = op.get_bind()
    foreign_keys = sa.inspect(bind).get_foreign_keys("oidc_login_states")
    current = next(
        (
            foreign_key
            for foreign_key in foreign_keys
            if foreign_key.get("constrained_columns") == ["link_attempt_id"]
        ),
        None,
    )
    if not current:
        return
    constraint_name = current.get("name")
    if not constraint_name:
        raise RuntimeError("oidc_login_states.link_attempt_id foreign key must be named before migration")
    # A previous non-transactional SQLite migration attempt may already have
    # renamed the referenced table while leaving this foreign key behind.
    # Avoid resolving the referenced table while Alembic reflects the source
    # table so the migration remains recoverable from that intermediate state.
    with op.batch_alter_table(
        "oidc_login_states",
        schema=None,
        reflect_kwargs={"resolve_fks": False},
    ) as batch_op:
        batch_op.drop_constraint(str(constraint_name), type_="foreignkey")


def _create_login_state_foreign_key(target_table: str, constraint_name: str) -> None:
    with op.batch_alter_table("oidc_login_states", schema=None) as batch_op:
        batch_op.create_foreign_key(
            constraint_name,
            target_table,
            ["link_attempt_id"],
            ["id"],
            ondelete="CASCADE",
        )


def _cleanup_sqlite_batch_residue() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        return
    tables = set(sa.inspect(bind).get_table_names())
    for table_name in (
        "_alembic_tmp_external_identity_link_attempts",
        "_alembic_tmp_oidc_login_states",
        "_alembic_tmp_ldap_providers",
    ):
        if table_name in tables:
            op.drop_table(table_name)


def upgrade() -> None:
    bind = op.get_bind()
    _cleanup_sqlite_batch_residue()
    inspector = sa.inspect(bind)
    table_names = set(inspector.get_table_names())
    renamed = "oidc_link_attempts" in table_names and "external_identity_link_attempts" not in table_names
    if renamed:
        _drop_login_state_foreign_key()
        op.rename_table("oidc_link_attempts", "external_identity_link_attempts")
        for column in _INDEX_COLUMNS:
            op.drop_index(
                f"ix_oidc_link_attempts_{column}",
                table_name="external_identity_link_attempts",
            )
            op.create_index(
                f"ix_external_identity_link_attempts_{column}",
                "external_identity_link_attempts",
                [column],
                unique=False,
            )

    link_columns = {
        column["name"]: column
        for column in sa.inspect(bind).get_columns("external_identity_link_attempts")
    }
    with op.batch_alter_table("external_identity_link_attempts", schema=None) as batch_op:
        if "provider_type" not in link_columns:
            batch_op.add_column(
                sa.Column(
                    "provider_type",
                    sa.String(),
                    nullable=False,
                    server_default="oidc",
                )
            )
        if not link_columns["issuer"]["nullable"]:
            batch_op.alter_column(
                "issuer",
                existing_type=sa.String(),
                nullable=True,
            )

    current_fk = next(
        (
            foreign_key
            for foreign_key in sa.inspect(bind).get_foreign_keys("oidc_login_states")
            if foreign_key.get("constrained_columns") == ["link_attempt_id"]
        ),
        None,
    )
    if current_fk is None:
        _create_login_state_foreign_key(
            "external_identity_link_attempts",
            "fk_oidc_login_states_link_attempt_id_external_identity_link_attempts",
        )
    elif current_fk.get("referred_table") != "external_identity_link_attempts":
        _drop_login_state_foreign_key()
        _create_login_state_foreign_key(
            "external_identity_link_attempts",
            "fk_oidc_login_states_link_attempt_id_external_identity_link_attempts",
        )
    ldap_columns = {column["name"] for column in sa.inspect(bind).get_columns("ldap_providers")}
    if "linking_policy" not in ldap_columns:
        with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
            batch_op.add_column(
                sa.Column(
                    "linking_policy",
                    sa.String(),
                    nullable=False,
                    server_default="manual",
                )
            )


def downgrade() -> None:
    _cleanup_sqlite_batch_residue()
    # Link attempts are short-lived. LDAP attempts cannot be represented by the
    # previous OIDC-only schema, so discard only those ephemeral rows.
    op.get_bind().execute(
        sa.text(
            "DELETE FROM external_identity_link_attempts "
            "WHERE provider_type <> 'oidc' OR issuer IS NULL"
        )
    )
    _drop_login_state_foreign_key()
    with op.batch_alter_table("external_identity_link_attempts", schema=None) as batch_op:
        batch_op.drop_column("provider_type")
        batch_op.alter_column(
            "issuer",
            existing_type=sa.String(),
            nullable=False,
        )

    for column in _INDEX_COLUMNS:
        op.drop_index(
            f"ix_external_identity_link_attempts_{column}",
            table_name="external_identity_link_attempts",
        )
        op.create_index(
            f"ix_oidc_link_attempts_{column}",
            "external_identity_link_attempts",
            [column],
            unique=False,
        )

    op.rename_table("external_identity_link_attempts", "oidc_link_attempts")
    _create_login_state_foreign_key(
        "oidc_link_attempts",
        "fk_oidc_login_states_link_attempt_id_oidc_link_attempts",
    )
    with op.batch_alter_table("ldap_providers", schema=None) as batch_op:
        batch_op.drop_column("linking_policy")
