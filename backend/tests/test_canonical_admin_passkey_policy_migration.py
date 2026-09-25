# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0130_canonical_admin_passkey_policy.py"
    )
    spec = util.spec_from_file_location(
        "migration_0130_canonical_admin_passkey_policy",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_settings_table(engine) -> sa.Table:
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    metadata.create_all(engine)
    return settings


def _run_migration(connection, monkeypatch) -> None:
    migration = _load_migration()
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )
    migration.upgrade()


def test_migration_persists_historical_admin_passkey_policy(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _create_settings_table(engine)
    explicit_false = json.dumps(
        {"general": {"require_passkey_for_admins": False}},
        indent=2,
    )

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "without-general",
                    "payload_json": json.dumps({"branding": {"primary_color": "#123abc"}}),
                },
                {
                    "key": "without-policy",
                    "payload_json": json.dumps({"general": {"manager_enabled": False}}),
                },
                {"key": "explicit-false", "payload_json": explicit_false},
                {
                    "key": "explicit-true",
                    "payload_json": json.dumps(
                        {"general": {"require_passkey_for_admins": True}}
                    ),
                },
            ],
        )

        _run_migration(connection, monkeypatch)

        rows = connection.execute(
            sa.text("SELECT key, payload_json FROM app_settings ORDER BY key")
        ).all()
        raw_payloads = {row.key: row.payload_json for row in rows}
        payloads = {key: json.loads(value) for key, value in raw_payloads.items()}

        assert payloads["without-general"]["general"]["require_passkey_for_admins"] is True
        assert payloads["without-policy"]["general"]["require_passkey_for_admins"] is True
        assert raw_payloads["explicit-false"] == explicit_false
        assert payloads["explicit-true"]["general"]["require_passkey_for_admins"] is True


@pytest.mark.parametrize(
    "invalid_payload",
    [
        "{",
        json.dumps(["not-an-object"]),
        json.dumps({"general": None}),
        json.dumps({"general": {"require_passkey_for_admins": "true"}}),
    ],
)
def test_migration_rejects_invalid_settings_before_updates(
    monkeypatch,
    invalid_payload,
):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _create_settings_table(engine)
    valid_missing_policy = json.dumps({"general": {"manager_enabled": False}})

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {"key": "valid", "payload_json": valid_missing_policy},
                {"key": "invalid", "payload_json": invalid_payload},
            ],
        )

        with pytest.raises(ValueError):
            _run_migration(connection, monkeypatch)

        stored = connection.execute(
            sa.text("SELECT payload_json FROM app_settings WHERE key = 'valid'")
        ).scalar_one()
        assert stored == valid_missing_policy
