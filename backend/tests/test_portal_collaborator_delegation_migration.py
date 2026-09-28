# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0134_portal_collaborator_delegation.py"
    )
    spec = util.spec_from_file_location("migration_0134_portal_collaborator_delegation", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_portal_collaborator_delegation_defaults_and_downgrade(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    requests = sa.Table(
        "portal_admin_requests",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_type", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.CheckConstraint(
            "request_type IN ('portal_user_access', 'portal_user_removal', 'portal_role_change', 'account_quota_change', 'portal_setting_change')",
            name="ck_portal_admin_requests_type",
        ),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(accounts.insert().values(id=1, name="existing"))
        connection.execute(
            requests.insert().values(
                id=1,
                request_type="portal_role_change",
                payload_json='{"target_user_id": 7, "portal_role": "portal_manager"}',
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("s3_accounts")}
        assert columns["portal_collaborator_role_management_delegated"]["nullable"] is False
        assert columns["portal_collaborator_addition_delegated"]["nullable"] is False
        existing = connection.execute(
            sa.text(
                "SELECT portal_collaborator_role_management_delegated, "
                "portal_collaborator_addition_delegated FROM s3_accounts WHERE id = 1"
            )
        ).one()
        assert bool(existing.portal_collaborator_role_management_delegated) is False
        assert bool(existing.portal_collaborator_addition_delegated) is False

        connection.execute(sa.text("INSERT INTO s3_accounts (id, name) VALUES (2, 'new')"))
        created = connection.execute(
            sa.text(
                "SELECT portal_collaborator_role_management_delegated, "
                "portal_collaborator_addition_delegated FROM s3_accounts WHERE id = 2"
            )
        ).one()
        assert bool(created.portal_collaborator_role_management_delegated) is False
        assert bool(created.portal_collaborator_addition_delegated) is False
        migrated = connection.execute(
            sa.text(
                "SELECT request_type, payload_json FROM portal_admin_requests WHERE id = 1"
            )
        ).one()
        assert migrated.request_type == "portal_user_access"
        assert json.loads(migrated.payload_json)["intent"] == "role_change"

        migration.downgrade()

        remaining = {column["name"] for column in sa.inspect(connection).get_columns("s3_accounts")}
        assert "portal_collaborator_role_management_delegated" not in remaining
        assert "portal_collaborator_addition_delegated" not in remaining
        restored = connection.execute(
            sa.text(
                "SELECT request_type, payload_json FROM portal_admin_requests WHERE id = 1"
            )
        ).one()
        assert restored.request_type == "portal_role_change"
        assert "intent" not in json.loads(restored.payload_json)
