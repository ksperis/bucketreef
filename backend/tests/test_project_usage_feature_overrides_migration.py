# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0151_project_usage_feature_overrides.py"
    spec = importlib.util.spec_from_file_location("project_usage_feature_overrides_migration", path)
    assert spec and spec.loader
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_project_usage_feature_overrides_migration_round_trips_settings_and_columns():
    migration = _load_migration()
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    settings = sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )
    accounts = sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    metadata.create_all(engine)

    original = {
        "general": {
            "bucket_usage_stats_enabled": False,
            "portal_enabled": True,
        },
        "manager": {
            "manager_rgw_usage_metrics_enabled": False,
            "bucket_migration_parallelism_default": 4,
        },
        "unrelated": {"preserved": True},
    }

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {"key": "default", "payload_json": json.dumps(original)},
                {"key": "installation_id", "payload_json": json.dumps("installation-identifier")},
            ],
        )
        connection.execute(accounts.insert().values(id=1))
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        columns = {column["name"]: column for column in sa.inspect(connection).get_columns("s3_accounts")}
        assert columns["allow_rgw_usage_metrics"]["nullable"] is True
        assert columns["allow_bucket_usage_stats"]["nullable"] is True
        account = connection.execute(sa.text("SELECT * FROM s3_accounts WHERE id = 1")).mappings().one()
        assert account["allow_rgw_usage_metrics"] is None
        assert account["allow_bucket_usage_stats"] is None

        payload = json.loads(
            connection.execute(
                sa.select(settings.c.payload_json).where(settings.c.key == "default")
            ).scalar_one()
        )
        assert payload["general"]["project_feature_policies"]["bucket_usage_stats"] == "disabled"
        assert "bucket_usage_stats_enabled" not in payload["general"]
        assert payload["manager"]["feature_policies"]["rgw_usage_metrics"] == "disabled"
        assert "manager_rgw_usage_metrics_enabled" not in payload["manager"]
        assert payload["general"]["portal_enabled"] is True
        assert payload["manager"]["bucket_migration_parallelism_default"] == 4
        assert payload["unrelated"] == {"preserved": True}
        assert connection.execute(
            sa.select(settings.c.payload_json).where(settings.c.key == "installation_id")
        ).scalar_one() == json.dumps("installation-identifier")

        migration.downgrade()

        payload = json.loads(
            connection.execute(
                sa.select(settings.c.payload_json).where(settings.c.key == "default")
            ).scalar_one()
        )
        assert payload["general"]["bucket_usage_stats_enabled"] is False
        assert "project_feature_policies" not in payload["general"]
        assert payload["manager"]["manager_rgw_usage_metrics_enabled"] is False
        assert "rgw_usage_metrics" not in payload["manager"].get("feature_policies", {})
        columns = {column["name"] for column in sa.inspect(connection).get_columns("s3_accounts")}
        assert "allow_rgw_usage_metrics" not in columns
        assert "allow_bucket_usage_stats" not in columns
