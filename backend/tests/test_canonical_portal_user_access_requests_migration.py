# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
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
        / "0156_canonical_portal_user_access_requests.py"
    )
    spec = util.spec_from_file_location(
        "migration_0156_canonical_portal_user_access_requests",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_legacy_collaborator_additions(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    requests = sa.Table(
        "portal_admin_requests",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_type", sa.String(), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)

    legacy_add = {"target_name": "Jane", "target_email": "jane@example.org"}
    manager_add = {
        "intent": "add",
        "target_name": "Manager",
        "target_email": "manager@example.org",
        "portal_role": "portal_manager",
    }
    role_change = {
        "intent": "role_change",
        "target_user_id": 7,
        "portal_role": "portal_manager",
    }

    with engine.begin() as connection:
        connection.execute(
            requests.insert(),
            [
                {"id": 1, "request_type": "portal_user_access", "payload_json": json.dumps(legacy_add)},
                {"id": 2, "request_type": "portal_user_access", "payload_json": json.dumps(manager_add)},
                {"id": 3, "request_type": "portal_user_access", "payload_json": json.dumps(role_change)},
                {"id": 4, "request_type": "portal_user_removal", "payload_json": json.dumps({"target_email": "old@example.org"})},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        rows = {
            row.id: json.loads(row.payload_json)
            for row in connection.execute(
                sa.select(requests.c.id, requests.c.payload_json).order_by(requests.c.id)
            )
        }
        assert rows[1] == {
            **legacy_add,
            "intent": "add",
            "portal_role": "portal_user",
        }
        assert rows[2] == manager_add
        assert rows[3] == role_change
        assert rows[4] == {"target_email": "old@example.org"}

        migration.downgrade()

        downgraded = {
            row.id: json.loads(row.payload_json)
            for row in connection.execute(
                sa.select(requests.c.id, requests.c.payload_json).order_by(requests.c.id)
            )
        }
        assert downgraded[1] == legacy_add
        assert downgraded[2] == {
            "target_name": "Manager",
            "target_email": "manager@example.org",
            "portal_role": "portal_manager",
        }
        assert downgraded[3] == role_change
        assert downgraded[4] == {"target_email": "old@example.org"}
