# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0222_external_identity_link_attempts.py"
)


def _load_migration():
    spec = util.spec_from_file_location("migration_0222_external_identity_link_attempts", MIGRATION_PATH)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def _create_0221_schema(connection) -> None:
    metadata = sa.MetaData()
    sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    sa.Table(
        "auth_sessions",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
    )
    sa.Table(
        "external_identities",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
    )
    attempts = sa.Table(
        "oidc_link_attempts",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("issuer", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=True),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("picture_url", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("browser_secret_hash", sa.String(), nullable=False),
        sa.Column(
            "initiating_auth_session_id",
            sa.String(),
            sa.ForeignKey("auth_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "existing_identity_id",
            sa.String(),
            sa.ForeignKey("external_identities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("proof_method", sa.String(), nullable=True),
        sa.Column("proof_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mfa_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("redirect_path", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
    )
    for column in (
        "user_id",
        "initiating_auth_session_id",
        "existing_identity_id",
        "status",
        "expires_at",
        "consumed_at",
    ):
        sa.Index(f"ix_oidc_link_attempts_{column}", attempts.c[column])
    sa.Table(
        "oidc_login_states",
        metadata,
        sa.Column("state", sa.String(), primary_key=True),
        sa.Column("link_attempt_id", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(
            ["link_attempt_id"],
            ["oidc_link_attempts.id"],
            name="fk_oidc_login_states_link_attempt_id_oidc_link_attempts",
            ondelete="CASCADE",
        ),
    )
    ldap = sa.Table(
        "ldap_providers",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider_id", sa.String(), nullable=False),
    )
    metadata.create_all(connection)
    connection.execute(sa.text("INSERT INTO users (id) VALUES (1)"))
    created_at = datetime(2026, 10, 30, 20, 0, tzinfo=timezone.utc)
    connection.execute(
        attempts.insert().values(
            id="attempt-1",
            user_id=1,
            provider_id="company",
            issuer="https://issuer.example.test",
            subject="subject-1",
            source="login_collision",
            browser_secret_hash="browser-hash",
            created_at=created_at,
            expires_at=created_at + timedelta(minutes=15),
        )
    )
    connection.execute(ldap.insert().values(id=1, provider_id="corp"))


def test_external_identity_link_attempts_migration_upgrade_and_downgrade(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_0221_schema(connection)
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        inspector = sa.inspect(connection)
        assert "external_identity_link_attempts" in inspector.get_table_names()
        assert "oidc_link_attempts" not in inspector.get_table_names()
        columns = {column["name"]: column for column in inspector.get_columns("external_identity_link_attempts")}
        assert columns["provider_type"]["nullable"] is False
        assert columns["issuer"]["nullable"] is True
        row = connection.execute(
            sa.text(
                "SELECT provider_type, issuer FROM external_identity_link_attempts "
                "WHERE id = 'attempt-1'"
            )
        ).one()
        assert row.provider_type == "oidc"
        assert row.issuer == "https://issuer.example.test"
        login_state_fk = next(
            foreign_key
            for foreign_key in inspector.get_foreign_keys("oidc_login_states")
            if foreign_key["constrained_columns"] == ["link_attempt_id"]
        )
        assert login_state_fk["referred_table"] == "external_identity_link_attempts"
        ldap_columns = {column["name"] for column in inspector.get_columns("ldap_providers")}
        assert "linking_policy" in ldap_columns
        assert connection.execute(
            sa.text("SELECT linking_policy FROM ldap_providers WHERE id = 1")
        ).scalar_one() == "manual"

        migration.downgrade()

        inspector = sa.inspect(connection)
        assert "oidc_link_attempts" in inspector.get_table_names()
        assert "external_identity_link_attempts" not in inspector.get_table_names()
        columns = {column["name"]: column for column in inspector.get_columns("oidc_link_attempts")}
        assert "provider_type" not in columns
        assert columns["issuer"]["nullable"] is False
        login_state_fk = next(
            foreign_key
            for foreign_key in inspector.get_foreign_keys("oidc_login_states")
            if foreign_key["constrained_columns"] == ["link_attempt_id"]
        )
        assert login_state_fk["referred_table"] == "oidc_link_attempts"
        ldap_columns = {column["name"] for column in inspector.get_columns("ldap_providers")}
        assert "linking_policy" not in ldap_columns
