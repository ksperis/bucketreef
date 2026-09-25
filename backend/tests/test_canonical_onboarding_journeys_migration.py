# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from importlib import util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations

from app.db.utc_datetime import UTCDateTime


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0131_canonical_onboarding_journeys.py"
    )
    spec = util.spec_from_file_location("migration_0131_canonical_onboarding_journeys", path)
    assert spec and spec.loader
    module = util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_schema(engine) -> None:
    metadata = sa.MetaData()
    sa.Table(
        "users",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
    )
    sa.Table(
        "onboarding_preferences",
        metadata,
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("dismissed", sa.Boolean(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    sa.Table(
        "onboarding_journeys",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("draft_json", sa.Text(), nullable=False),
        sa.Column("configured_at", UTCDateTime(), nullable=True),
    )
    metadata.create_all(engine)


def test_migration_keeps_only_current_journeys_and_preserves_legacy_completion(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    _create_schema(engine)
    older = datetime(2026, 9, 20, 8, 0, tzinfo=timezone.utc)
    newer = older + timedelta(days=1)
    preference_updated = older - timedelta(days=2)

    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO users (id) VALUES (1), (2), (3)"))
        connection.execute(
            sa.text(
                "INSERT INTO onboarding_preferences (user_id, dismissed, updated_at) "
                "VALUES (1, 1, :updated_at)"
            ),
            {"updated_at": preference_updated},
        )
        connection.execute(
            sa.text(
                "INSERT INTO onboarding_journeys (id, user_id, draft_json, configured_at) "
                "VALUES (:id, :user_id, :draft_json, :configured_at)"
            ),
            [
                {"id": "legacy-old", "user_id": 1, "draft_json": json.dumps({"workspace": "manager"}), "configured_at": older},
                {"id": "legacy-new", "user_id": 1, "draft_json": "{", "configured_at": newer},
                {"id": "legacy-incomplete", "user_id": 2, "draft_json": json.dumps({"workspace": "portal"}), "configured_at": None},
                {"id": "current", "user_id": 3, "draft_json": json.dumps({"version": 2, "manager": True}), "configured_at": None},
            ],
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )
        migration.upgrade()

        journeys = connection.execute(
            sa.text("SELECT id, draft_json FROM onboarding_journeys ORDER BY id")
        ).all()
        assert journeys == [("current", json.dumps({"version": 2, "manager": True}))]

        preferences = connection.execute(
            sa.text(
                "SELECT user_id, dismissed, initial_setup_completed_at, updated_at "
                "FROM onboarding_preferences ORDER BY user_id"
            )
        ).mappings().all()
        assert [row["user_id"] for row in preferences] == [1]
        assert preferences[0]["dismissed"] == 1
        assert preferences[0]["initial_setup_completed_at"] is not None
        assert preferences[0]["updated_at"] == preference_updated.isoformat(sep=" ")


def test_migration_creates_missing_preference_for_configured_legacy_journey(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    _create_schema(engine)
    completed_at = datetime(2026, 9, 21, 9, 30, tzinfo=timezone.utc)

    with engine.begin() as connection:
        connection.execute(sa.text("INSERT INTO users (id) VALUES (1)"))
        connection.execute(
            sa.text(
                "INSERT INTO onboarding_journeys (id, user_id, draft_json, configured_at) "
                "VALUES ('legacy', 1, :draft_json, :configured_at)"
            ),
            {"draft_json": json.dumps({"workspace": "browser"}), "configured_at": completed_at},
        )
        migration = _load_migration()
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))

        migration.upgrade()

        row = connection.execute(
            sa.text(
                "SELECT dismissed, initial_setup_completed_at, updated_at "
                "FROM onboarding_preferences WHERE user_id = 1"
            )
        ).mappings().one()
        assert row["dismissed"] == 0
        assert row["initial_setup_completed_at"] is not None
        assert row["updated_at"] is not None
        assert connection.scalar(sa.text("SELECT count(*) FROM onboarding_journeys")) == 0
