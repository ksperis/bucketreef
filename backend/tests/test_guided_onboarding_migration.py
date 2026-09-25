# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import postgresql

from app.db import OnboardingJourney, OnboardingPreference
from app.db.utc_datetime import UTCDateTime


@pytest.mark.parametrize("dismissed", [False, True])
def test_upgrade_preserves_only_existing_admin_dismissal_and_downgrades(monkeypatch, dismissed):
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0125_guided_onboarding.py"
    spec = importlib.util.spec_from_file_location("onboarding_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.exec_driver_sql("CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL)")
        connection.exec_driver_sql("CREATE TABLE app_settings (key TEXT PRIMARY KEY, payload_json TEXT NOT NULL)")
        connection.exec_driver_sql("INSERT INTO users VALUES (1, 'ui_superadmin'), (2, 'ui_admin'), (3, 'ui_user')")
        connection.execute(sa.text("INSERT INTO app_settings VALUES ('default', :payload)"), {"payload": json.dumps({"onboarding": {"dismissed": dismissed}})})
        monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
        module.upgrade()
        preferences = sa.table(
            "onboarding_preferences",
            sa.column("user_id", sa.Integer()),
            sa.column("dismissed", sa.Boolean()),
            sa.column("updated_at", UTCDateTime()),
        )
        rows = connection.execute(
            sa.select(preferences).order_by(preferences.c.user_id)
        ).all()
        assert [(row.user_id, row.dismissed) for row in rows] == [(1, dismissed), (2, dismissed)]
        assert all(row.updated_at.tzinfo is not None for row in rows)
        assert sa.inspect(connection).get_indexes("onboarding_journeys")[0]["column_names"] == ["user_id"]
        connection.exec_driver_sql("DELETE FROM users WHERE id=1")
        assert connection.scalar(sa.text("SELECT count(*) FROM onboarding_preferences")) == 1
        module.downgrade()
        assert "onboarding_preferences" not in sa.inspect(connection).get_table_names()
        assert connection.scalar(sa.text("SELECT count(*) FROM users")) == 2


def test_postgresql_schema_uses_timezone_aware_timestamps_and_cascade():
    for model in (OnboardingJourney, OnboardingPreference):
        sql = str(sa.schema.CreateTable(model.__table__).compile(dialect=postgresql.dialect()))
        assert "TIMESTAMP WITH TIME ZONE" in sql
        assert "ON DELETE CASCADE" in sql
