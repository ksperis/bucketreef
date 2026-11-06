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
        / "0258_canonical_static_app_settings.py"
    )
    spec = util.spec_from_file_location("migration_0258_canonical_static_app_settings", path)
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


def test_migration_materializes_static_defaults_and_preserves_explicit_values():
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
                        },
                        "portal": {
                            "feature_policies": {"browser_access": "disabled"},
                        },
                        "branding": {"primary_color": "#123456"},
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
        assert payload["portal"]["feature_policies"]["browser_access"] == "disabled"
        assert payload["branding"]["primary_color"] == "#123456"
        assert payload["browser"] == migration._STATIC_DEFAULTS["browser"]
        assert payload["quota_notifications"] == migration._STATIC_DEFAULTS["quota_notifications"]
        assert "cors_allowed_origins" not in payload["portal"]["bucket_defaults"]
        assert "bucket_migration_parallelism_default" not in payload["manager"]
        assert "bucket_migration_parallelism_max" not in payload["manager"]
        assert "bucket_migration_max_active_per_endpoint" not in payload["manager"]
        assert connection.scalar(
            sa.select(settings.c.payload).where(
                settings.c.key == "endpoint-service-identity-installation"
            )
        ) == "installation-id"


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"general": None},
        {"portal": {"feature_policies": "invalid"}},
        {"manager": {"feature_policies": []}},
    ],
)
def test_migration_rejects_invalid_objects(payload):
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="default", payload=payload))
        migration = _load_migration()
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(ValueError):
            migration.upgrade()
