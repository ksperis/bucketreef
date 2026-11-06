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
        / "0257_remove_obsolete_onboarding_setting.py"
    )
    spec = util.spec_from_file_location("migration_0257_remove_obsolete_onboarding_setting", path)
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


def _run_migration(connection) -> None:
    migration = _load_migration()
    migration.op = Operations(MigrationContext.configure(connection))
    migration.upgrade()


def test_migration_removes_only_global_onboarding_setting():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "default",
                    "payload": {
                        "general": {"manager_enabled": True},
                        "onboarding": {"dismissed": True},
                        "branding": {"primary_color": "#123456"},
                    },
                },
                {
                    "key": "endpoint-service-identity-installation",
                    "payload": "installation-id",
                },
            ],
        )

        _run_migration(connection)

        payload = connection.scalar(
            sa.select(settings.c.payload).where(settings.c.key == "default")
        )
        assert payload == {
            "general": {"manager_enabled": True},
            "branding": {"primary_color": "#123456"},
        }
        assert connection.scalar(
            sa.select(settings.c.payload).where(
                settings.c.key == "endpoint-service-identity-installation"
            )
        ) == "installation-id"


def test_migration_rejects_invalid_default_payload():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="default", payload=[]))
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(ValueError):
            migration.upgrade()
