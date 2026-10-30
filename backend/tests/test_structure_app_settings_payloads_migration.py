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
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0205_structure_app_settings_payloads.py"
    )
    spec = util.spec_from_file_location("migration_0205_structure_app_settings_payloads", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _app_settings(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "app_settings",
        metadata,
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )


def test_migration_materializes_objects_and_scalars_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    settings = _app_settings(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            settings.insert(),
            [
                {"key": "default", "payload_json": json.dumps({"general": {"manager_enabled": True}})},
                {"key": "installation", "payload_json": json.dumps("installation-id")},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("app_settings")}
        assert "payload" in columns
        assert "payload_json" not in columns
        rows = connection.execute(
            sa.text("SELECT key, payload FROM app_settings ORDER BY key")
        ).all()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(rows[0].payload) == {"general": {"manager_enabled": True}}
        assert processor(rows[1].payload) == "installation-id"

        migration.downgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("app_settings")}
        assert "payload" not in columns
        assert "payload_json" in columns
        restored = {
            row.key: json.loads(row.payload_json)
            for row in connection.execute(
                sa.text("SELECT key, payload_json FROM app_settings ORDER BY key")
            )
        }
        assert restored == {
            "default": {"general": {"manager_enabled": True}},
            "installation": "installation-id",
        }


def test_migration_rejects_invalid_json(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    settings = _app_settings(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(settings.insert().values(key="broken", payload_json="{"))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Application setting broken payload_json"):
            migration.upgrade()
