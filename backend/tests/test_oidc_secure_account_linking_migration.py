# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0220_oidc_secure_account_linking.py"
)


def _load_migration():
    spec = util.spec_from_file_location("migration_0220_oidc_secure_account_linking", MIGRATION_PATH)
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


def _create_0219_schema(connection) -> None:
    metadata = sa.MetaData()
    users = sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"),
    )
    identities = sa.Table(
        "external_identities",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_type", sa.String(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "provider_type",
            "provider_id",
            "subject",
            name="uq_external_identity_subject",
        ),
    )
    requests = sa.Table(
        "external_identity_link_requests",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_type", sa.String(), nullable=False),
        sa.Column("provider_id", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.UniqueConstraint(
            "provider_type",
            "provider_id",
            "subject",
            name="uq_external_link_request_subject",
        ),
    )
    login_states = sa.Table(
        "oidc_login_states",
        metadata,
        sa.Column("state", sa.String(), primary_key=True),
    )
    sessions = sa.Table(
        "auth_sessions",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(), nullable=True),
    )
    refresh_tokens = sa.Table(
        "refresh_tokens",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("auth_session_id", sa.String(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(), nullable=True),
    )
    api_tokens = sa.Table(
        "api_tokens",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    openstack_sessions = sa.Table(
        "openstack_sessions",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("auth_session_id", sa.String(), nullable=False),
    )
    metadata.create_all(connection)

    connection.execute(users.insert(), [{"id": 1, "auth_version": 3}, {"id": 2, "auth_version": 5}])
    connection.execute(
        identities.insert(),
        [
            {
                "id": "oidc-legacy",
                "user_id": 1,
                "provider_type": "oidc",
                "provider_id": "google",
                "subject": "oidc-subject",
            },
            {
                "id": "ldap-current",
                "user_id": 2,
                "provider_type": "ldap",
                "provider_id": "directory",
                "subject": "uid=ldap",
            },
        ],
    )
    connection.execute(
        requests.insert(),
        [
            {
                "id": "oidc-request",
                "user_id": 1,
                "provider_type": "oidc",
                "provider_id": "google",
                "subject": "oidc-subject",
            },
            {
                "id": "ldap-request",
                "user_id": 2,
                "provider_type": "ldap",
                "provider_id": "directory",
                "subject": "uid=ldap",
            },
        ],
    )
    connection.execute(login_states.insert().values(state="legacy-state"))
    connection.execute(
        sessions.insert(),
        [
            {"id": "oidc-session", "user_id": 1},
            {"id": "ldap-session", "user_id": 2},
        ],
    )
    connection.execute(
        refresh_tokens.insert(),
        [
            {"id": "oidc-refresh", "auth_session_id": "oidc-session"},
            {"id": "ldap-refresh", "auth_session_id": "ldap-session"},
        ],
    )
    connection.execute(
        api_tokens.insert(),
        [
            {"id": "oidc-api", "user_id": 1},
            {"id": "ldap-api", "user_id": 2},
        ],
    )
    connection.execute(
        openstack_sessions.insert(),
        [
            {"id": "oidc-openstack", "auth_session_id": "oidc-session"},
            {"id": "ldap-openstack", "auth_session_id": "ldap-session"},
        ],
    )


def test_upgrade_discards_legacy_oidc_links_and_revokes_affected_auth_state(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_0219_schema(connection)
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        inspector = sa.inspect(connection)
        identity_columns = {column["name"] for column in inspector.get_columns("external_identities")}
        attempt_columns = {column["name"] for column in inspector.get_columns("oidc_link_attempts")}
        assert "issuer" in identity_columns
        assert "revalidation_required" not in identity_columns
        assert "existing_identity_id" not in attempt_columns

        assert connection.execute(
            sa.text("SELECT id FROM external_identities ORDER BY id")
        ).scalars().all() == ["ldap-current"]
        assert connection.execute(
            sa.text("SELECT id FROM external_identity_link_requests ORDER BY id")
        ).scalars().all() == ["ldap-request"]
        assert connection.scalar(sa.text("SELECT COUNT(*) FROM oidc_login_states")) == 0

        assert connection.execute(
            sa.text("SELECT id, auth_version FROM users ORDER BY id")
        ).all() == [(1, 4), (2, 5)]
        assert connection.execute(
            sa.text("SELECT id, revoke_reason FROM auth_sessions ORDER BY id")
        ).all() == [("ldap-session", None), ("oidc-session", "oidc_identity_cutover")]
        assert connection.execute(
            sa.text("SELECT id, revoke_reason FROM refresh_tokens ORDER BY id")
        ).all() == [("ldap-refresh", None), ("oidc-refresh", "oidc_identity_cutover")]
        api_revoked = connection.execute(
            sa.text("SELECT id, revoked_at FROM api_tokens ORDER BY id")
        ).all()
        assert api_revoked[0] == ("ldap-api", None)
        assert api_revoked[1][0] == "oidc-api"
        assert api_revoked[1][1] is not None
        assert connection.execute(
            sa.text("SELECT id FROM openstack_sessions ORDER BY id")
        ).scalars().all() == ["ldap-openstack"]
