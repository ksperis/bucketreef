# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_upgrade_preserves_choices_and_leaves_other_settings_keys_untouched():
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0148_feature_policies.py"
    spec = importlib.util.spec_from_file_location("feature_policies_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = sa.create_engine("sqlite://")
    metadata = sa.MetaData()
    settings = sa.Table("app_settings", metadata, sa.Column("key", sa.String(), primary_key=True), sa.Column("payload_json", sa.Text()))
    tables = {}
    for name, fields in migration.RESOURCE_FIELDS.items():
        tables[name] = sa.Table(name, metadata, sa.Column("id", sa.Integer(), primary_key=True),
                               *(sa.Column(field, sa.Boolean(), nullable=False, server_default=sa.false()) for field in fields))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(settings.insert(), [
            {
                "key": "default",
                "payload_json": json.dumps(
                    {
                        "general": {
                            "bucket_compare_enabled": True,
                            "bucket_usage_stats_enabled": False,
                        },
                        "manager": {"manager_rgw_usage_metrics_enabled": False},
                        "portal": {"allow_portal_user_external_sharing": False},
                    }
                ),
            },
            {"key": "installation_id", "payload_json": json.dumps("installation-identifier")},
        ])
        for table in tables.values():
            connection.execute(table.insert(), [{"id": 1, **{field: False for field in migration.RESOURCE_FIELDS[table.name]}},
                                               {"id": 2, **{field: True for field in migration.RESOURCE_FIELDS[table.name]}}])
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        payload = json.loads(connection.execute(sa.select(settings.c.payload_json).where(settings.c.key == "default")).scalar_one())
        assert payload["manager"]["feature_policies"]["bucket_compare"] == "targeted"
        assert payload["portal"]["feature_policies"]["user_external_sharing"] == "targeted"
        assert payload["general"]["bucket_usage_stats_enabled"] is False
        assert payload["manager"]["manager_rgw_usage_metrics_enabled"] is False
        assert connection.execute(sa.select(settings.c.payload_json).where(settings.c.key == "installation_id")).scalar_one() == json.dumps("installation-identifier")
        for name, fields in migration.RESOURCE_FIELDS.items():
            rows = connection.execute(sa.text(f"SELECT * FROM {name} ORDER BY id")).mappings().all()
            assert all(rows[0][field] == 0 and rows[1][field] == 1 for field in fields)
            connection.execute(sa.text(f"INSERT INTO {name} (id) VALUES (3)"))
            created = connection.execute(sa.text(f"SELECT * FROM {name} WHERE id=3")).mappings().one()
            assert all(created[field] is None for field in fields)
            assert all(column["nullable"] for column in sa.inspect(connection).get_columns(name) if column["name"] in fields)
