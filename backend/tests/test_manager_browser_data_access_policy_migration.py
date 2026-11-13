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
        / "0273_manager_browser_data_access_policy.py"
    )
    spec = util.spec_from_file_location("migration_0273_manager_browser_data_access_policy", path)
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


def test_migration_materializes_disabled_policy_and_preserves_settings():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {
                    "key": "default",
                    "payload": {
                        "manager": {
                            "feature_policies": {
                                "bucket_quota_management": "targeted",
                            },
                            "bucket_migration_parallelism_default": 3,
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

        _run_migration(connection)
        payload = connection.scalar(
            sa.select(settings.c.payload).where(settings.c.key == "default")
        )

        assert payload["manager"]["feature_policies"]["manager_browser_data_access"] == "disabled"
        assert payload["manager"]["feature_policies"]["bucket_quota_management"] == "targeted"
        assert payload["manager"]["bucket_migration_parallelism_default"] == 3
        assert payload["branding"]["primary_color"] == "#123456"
        assert connection.scalar(
            sa.select(settings.c.payload).where(
                settings.c.key == "endpoint-service-identity-installation"
            )
        ) == "installation-id"


def test_migration_preserves_explicit_policy_and_is_idempotent():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert().values(
                key="default",
                payload={
                    "manager": {
                        "feature_policies": {
                            "manager_browser_data_access": "default_on",
                        }
                    }
                },
            )
        )

        migration = _run_migration(connection)
        migration.upgrade()
        payload = connection.scalar(
            sa.select(settings.c.payload).where(settings.c.key == "default")
        )

        assert payload["manager"]["feature_policies"]["manager_browser_data_access"] == "default_on"


def test_migration_downgrade_removes_only_manager_browser_policy():
    engine = sa.create_engine("sqlite:///:memory:")
    settings = _schema(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert().values(
                key="default",
                payload={
                    "manager": {
                        "feature_policies": {
                            "bucket_quota_management": "targeted",
                        }
                    }
                },
            )
        )

        migration = _run_migration(connection)
        migration.downgrade()
        payload = connection.scalar(
            sa.select(settings.c.payload).where(settings.c.key == "default")
        )

        assert "manager_browser_data_access" not in payload["manager"]["feature_policies"]
        assert payload["manager"]["feature_policies"]["bucket_quota_management"] == "targeted"


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"manager": None},
        {"manager": {"feature_policies": []}},
        {"manager": {"feature_policies": {"manager_browser_data_access": "invalid"}}},
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
