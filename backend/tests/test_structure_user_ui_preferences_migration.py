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
        / "0212_structure_user_ui_preferences.py"
    )
    spec = util.spec_from_file_location(
        "migration_0212_structure_user_ui_preferences",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _users(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "ui_preferences_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
    )


def test_migration_materializes_structured_preferences_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = _users(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [
                {
                    "id": 1,
                    "ui_preferences_json": json.dumps(
                        {
                            "theme": "dark",
                            "selected_portal_account_id": "101",
                        }
                    ),
                },
                {"id": 2, "ui_preferences_json": "{}"},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("users")
        }
        assert "ui_preferences" in columns
        assert "ui_preferences_json" not in columns
        rows = connection.execute(
            sa.text("SELECT id, ui_preferences FROM users ORDER BY id")
        ).all()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(rows[0].ui_preferences) == {
            "theme": "dark",
            "selected_portal_account_id": "101",
        }
        assert processor(rows[1].ui_preferences) == {}

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("users")
        }
        assert "ui_preferences" not in columns
        assert "ui_preferences_json" in columns
        restored = connection.execute(
            sa.text("SELECT id, ui_preferences_json FROM users ORDER BY id")
        ).all()
        assert json.loads(restored[0].ui_preferences_json) == {
            "theme": "dark",
            "selected_portal_account_id": "101",
        }
        assert json.loads(restored[1].ui_preferences_json) == {}


@pytest.mark.parametrize("value", ["{", "[]", '"dark"', "null"])
def test_migration_rejects_non_object_preferences(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    users = _users(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            users.insert().values(id=1, ui_preferences_json=value)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="User 1 ui_preferences_json"):
            migration.upgrade()
