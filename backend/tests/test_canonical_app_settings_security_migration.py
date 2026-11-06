# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0256_canonical_app_settings_security.py"
    )
    spec = util.spec_from_file_location("migration_0256_canonical_app_settings_security", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _schema(engine) -> sa.Table:
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload", sa.JSON(), nullable=False),
    )
    metadata.create_all(engine)
    return settings


def _run_migration(connection):
    migration = _load_migration()
    migration.op = Operations(MigrationContext.configure(connection))
    migration.upgrade()
    return migration


def test_migration_materializes_only_default_settings_security_policy():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "default",
                    "payload": {
                        "general": {
                            "manager_enabled": False,
                            "require_passkey_for_admins": True,
                        }
                    },
                },
                {
                    "key": "endpoint-service-identity-installation",
                    "payload": "installation-id",
                },
            ],
        )

        migration = _run_migration(connection)

        payload = connection.scalar(
            sa.select(settings.c.payload).where(settings.c.key == "default")
        )
        assert payload["general"]["manager_enabled"] is False
        assert payload["general"]["require_passkey_for_admins"] is True
        for field, default in migration._CANONICAL_SECURITY_DEFAULTS.items():
            if field == "require_passkey_for_admins":
                continue
            assert payload["general"][field] is default
        assert connection.scalar(
            sa.select(settings.c.payload).where(
                settings.c.key == "endpoint-service-identity-installation"
            )
        ) == "installation-id"


def test_migration_materializes_security_policy_when_general_is_absent():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="default", payload={"branding": {}}))
        migration = _run_migration(connection)

        payload = connection.scalar(sa.select(settings.c.payload))
        assert payload["general"] == migration._CANONICAL_SECURITY_DEFAULTS


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"general": None},
        {"general": "invalid"},
        {"general": {"require_passkey_for_users": "false"}},
    ],
)
def test_migration_rejects_invalid_default_settings(payload):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="default", payload=payload))
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(ValueError):
            migration.upgrade()
