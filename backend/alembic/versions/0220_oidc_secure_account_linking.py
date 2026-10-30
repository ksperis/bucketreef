# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bind OIDC identities to issuers and add secure account-link attempts.

Revision ID: 0220_oidc_secure_account_linking
Revises: 0219_structure_s3_capabilities
Create Date: 2026-10-30
"""

from __future__ import annotations

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa


revision = "0220_oidc_secure_account_linking"
down_revision = "0219_structure_s3_capabilities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("external_identities", schema=None) as batch_op:
        batch_op.add_column(sa.Column("issuer", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "revalidation_required",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
        batch_op.drop_constraint("uq_external_identity_subject", type_="unique")
        batch_op.create_index("ix_external_identities_issuer", ["issuer"], unique=False)
        batch_op.create_index(
            "ix_external_identities_revalidation_required",
            ["revalidation_required"],
            unique=False,
        )
    op.create_index(
        "uq_external_identity_oidc_issuer_subject",
        "external_identities",
        ["issuer", "subject"],
        unique=True,
        sqlite_where=sa.text("provider_type = 'oidc'"),
        postgresql_where=sa.text("provider_type = 'oidc'"),
    )
    op.create_index(
        "uq_external_identity_ldap_provider_subject",
        "external_identities",
        ["provider_id", "subject"],
        unique=True,
        sqlite_where=sa.text("provider_type = 'ldap'"),
        postgresql_where=sa.text("provider_type = 'ldap'"),
    )

    with op.batch_alter_table("external_identity_link_requests", schema=None) as batch_op:
        batch_op.add_column(sa.Column("issuer", sa.String(), nullable=True))
        batch_op.drop_constraint("uq_external_link_request_subject", type_="unique")
    op.create_index(
        "uq_external_link_request_oidc_issuer_subject",
        "external_identity_link_requests",
        ["issuer", "subject"],
        unique=True,
        sqlite_where=sa.text("provider_type = 'oidc'"),
        postgresql_where=sa.text("provider_type = 'oidc'"),
    )
    op.create_index(
        "uq_external_link_request_ldap_provider_subject",
        "external_identity_link_requests",
        ["provider_id", "subject"],
        unique=True,
        sqlite_where=sa.text("provider_type = 'ldap'"),
        postgresql_where=sa.text("provider_type = 'ldap'"),
    )

    op.create_table(
        "oidc_provider_issuer_pins",
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("issuer", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("provider_id"),
    )
    op.create_index(
        "ix_oidc_provider_issuer_pins_issuer",
        "oidc_provider_issuer_pins",
        ["issuer"],
        unique=False,
    )

    op.create_table(
        "oidc_link_attempts",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("issuer", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("picture_url", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("browser_secret_hash", sa.String(), nullable=False),
        sa.Column("initiating_auth_session_id", sa.String(), nullable=True),
        sa.Column("existing_identity_id", sa.String(), nullable=True),
        sa.Column("proof_method", sa.String(), nullable=True),
        sa.Column("proof_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mfa_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("redirect_path", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["initiating_auth_session_id"],
            ["auth_sessions.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["existing_identity_id"],
            ["external_identities.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    for column in (
        "user_id",
        "initiating_auth_session_id",
        "existing_identity_id",
        "status",
        "expires_at",
        "consumed_at",
    ):
        op.create_index(f"ix_oidc_link_attempts_{column}", "oidc_link_attempts", [column], unique=False)

    with op.batch_alter_table("oidc_login_states", schema=None) as batch_op:
        batch_op.add_column(sa.Column("issuer", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("browser_secret_hash", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("purpose", sa.String(), nullable=False, server_default="login")
        )
        batch_op.add_column(sa.Column("target_user_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("link_attempt_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("auth_session_id", sa.String(), nullable=True))
        batch_op.add_column(
            sa.Column("require_auth_time", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_foreign_key(
            "fk_oidc_login_states_target_user_id_users",
            "users",
            ["target_user_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_oidc_login_states_link_attempt_id_oidc_link_attempts",
            "oidc_link_attempts",
            ["link_attempt_id"],
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
        for column in ("purpose", "target_user_id", "link_attempt_id", "auth_session_id"):
            batch_op.create_index(f"ix_oidc_login_states_{column}", [column], unique=False)

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    legacy_users = [
        int(row[0])
        for row in bind.execute(
            sa.text(
                "SELECT DISTINCT user_id FROM external_identities "
                "WHERE provider_type = 'oidc' AND revoked_at IS NULL"
            )
        ).all()
    ]

    bind.execute(
        sa.text(
            "UPDATE external_identities SET revalidation_required = :required "
            "WHERE provider_type = 'oidc' AND revoked_at IS NULL"
        ),
        {"required": True},
    )
    # States created by older code have no issuer/browser binding and must not
    # survive the upgrade into the stricter callback path.
    bind.execute(sa.text("DELETE FROM oidc_login_states WHERE issuer IS NULL"))

    if legacy_users:
        bind.execute(
            sa.text("UPDATE users SET auth_version = auth_version + 1 WHERE id IN :user_ids")
            .bindparams(sa.bindparam("user_ids", expanding=True)),
            {"user_ids": legacy_users},
        )
        session_ids = [
            str(row[0])
            for row in bind.execute(
                sa.text(
                    "SELECT id FROM auth_sessions "
                    "WHERE user_id IN :user_ids AND revoked_at IS NULL"
                ).bindparams(sa.bindparam("user_ids", expanding=True)),
                {"user_ids": legacy_users},
            ).all()
        ]
        if session_ids:
            bind.execute(
                sa.text(
                    "DELETE FROM openstack_sessions WHERE auth_session_id IN :session_ids"
                ).bindparams(sa.bindparam("session_ids", expanding=True)),
                {"session_ids": session_ids},
            )
            bind.execute(
                sa.text(
                    "UPDATE refresh_tokens SET revoked_at = :now, "
                    "revoke_reason = 'oidc_identity_revalidation_required' "
                    "WHERE auth_session_id IN :session_ids AND revoked_at IS NULL"
                ).bindparams(sa.bindparam("session_ids", expanding=True)),
                {"session_ids": session_ids, "now": now},
            )
            bind.execute(
                sa.text(
                    "UPDATE auth_sessions SET revoked_at = :now, "
                    "revoke_reason = 'oidc_identity_revalidation_required' "
                    "WHERE id IN :session_ids AND revoked_at IS NULL"
                ).bindparams(sa.bindparam("session_ids", expanding=True)),
                {"session_ids": session_ids, "now": now},
            )
        bind.execute(
            sa.text(
                "UPDATE api_tokens SET revoked_at = :now "
                "WHERE user_id IN :user_ids AND revoked_at IS NULL"
            ).bindparams(sa.bindparam("user_ids", expanding=True)),
            {"user_ids": legacy_users, "now": now},
        )


def downgrade() -> None:
    with op.batch_alter_table("oidc_login_states", schema=None) as batch_op:
        for column in ("auth_session_id", "link_attempt_id", "target_user_id", "purpose"):
            batch_op.drop_index(f"ix_oidc_login_states_{column}")
        batch_op.drop_constraint(
            "fk_oidc_login_states_auth_session_id_auth_sessions",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "fk_oidc_login_states_link_attempt_id_oidc_link_attempts",
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            "fk_oidc_login_states_target_user_id_users",
            type_="foreignkey",
        )
        for column in (
            "require_auth_time",
            "auth_session_id",
            "link_attempt_id",
            "target_user_id",
            "purpose",
            "browser_secret_hash",
            "issuer",
        ):
            batch_op.drop_column(column)

    for column in (
        "consumed_at",
        "expires_at",
        "status",
        "existing_identity_id",
        "initiating_auth_session_id",
        "user_id",
    ):
        op.drop_index(f"ix_oidc_link_attempts_{column}", table_name="oidc_link_attempts")
    op.drop_table("oidc_link_attempts")
    op.drop_index("ix_oidc_provider_issuer_pins_issuer", table_name="oidc_provider_issuer_pins")
    op.drop_table("oidc_provider_issuer_pins")

    op.drop_index(
        "uq_external_link_request_ldap_provider_subject",
        table_name="external_identity_link_requests",
    )
    op.drop_index(
        "uq_external_link_request_oidc_issuer_subject",
        table_name="external_identity_link_requests",
    )
    with op.batch_alter_table("external_identity_link_requests", schema=None) as batch_op:
        batch_op.create_unique_constraint(
            "uq_external_link_request_subject",
            ["provider_type", "provider_id", "subject"],
        )
        batch_op.drop_column("issuer")

    op.drop_index(
        "uq_external_identity_ldap_provider_subject",
        table_name="external_identities",
    )
    op.drop_index(
        "uq_external_identity_oidc_issuer_subject",
        table_name="external_identities",
    )
    with op.batch_alter_table("external_identities", schema=None) as batch_op:
        batch_op.drop_index("ix_external_identities_revalidation_required")
        batch_op.drop_index("ix_external_identities_issuer")
        batch_op.create_unique_constraint(
            "uq_external_identity_subject",
            ["provider_type", "provider_id", "subject"],
        )
        batch_op.drop_column("revalidation_required")
        batch_op.drop_column("issuer")
