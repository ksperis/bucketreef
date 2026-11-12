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
        / "0272_resource_feature_switches.py"
    )
    spec = util.spec_from_file_location("migration_0272_resource_feature_switches", path)
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


def test_existing_installation_keeps_previously_available_resources_enabled():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert().values(
                key="default",
                payload={"general": {"manager_enabled": True}},
            )
        )
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        payload = connection.scalar(
            sa.select(settings.c.payload).where(settings.c.key == "default")
        )

    assert payload["general"]["managed_rgw_accounts_enabled"] is True
    assert payload["general"]["managed_rgw_users_enabled"] is True
    assert payload["general"]["shared_s3_connections_enabled"] is True
    assert payload["general"]["private_s3_connections_enabled"] is True


def test_migration_preserves_explicit_feature_values():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert().values(
                key="default",
                payload={
                    "general": {
                        "managed_rgw_users_enabled": False,
                        "shared_s3_connections_enabled": False,
                    }
                },
            )
        )
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        payload = connection.scalar(
            sa.select(settings.c.payload).where(settings.c.key == "default")
        )

    assert payload["general"]["managed_rgw_users_enabled"] is False
    assert payload["general"]["shared_s3_connections_enabled"] is False
    assert payload["general"]["managed_rgw_accounts_enabled"] is True
    assert payload["general"]["private_s3_connections_enabled"] is True


def test_fresh_database_without_settings_row_is_not_materialized():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        assert connection.scalar(sa.select(sa.func.count()).select_from(settings)) == 0


@pytest.mark.parametrize("payload", [[], {"general": None}, {"general": {"private_s3_connections_enabled": "yes"}}])
def test_migration_rejects_invalid_payload(payload):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="default", payload=payload))
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))
        with pytest.raises(ValueError):
            migration.upgrade()
