# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from datetime import datetime, timezone
from importlib import util
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
        / "0255_canonical_onboarding_completion.py"
    )
    spec = util.spec_from_file_location("migration_0255_canonical_onboarding_completion", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _schema(engine):
    metadata = sa.MetaData()
    preferences = sa.Table(
        "onboarding_preferences",
        metadata,
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("dismissed", sa.Boolean(), nullable=False, default=False),
        sa.Column("initial_setup_completed_at", UTCDateTime(), nullable=True),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    journeys = sa.Table(
        "onboarding_journeys",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False, index=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("resources", sa.JSON(), nullable=False),
        sa.Column("pending_step", sa.String(40), nullable=True),
        sa.Column("configured_at", UTCDateTime(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )
    metadata.create_all(engine)
    return preferences, journeys


def test_migration_materializes_only_effective_historical_completion_and_downgrades():
    engine = sa.create_engine("sqlite:///:memory:")
    preferences, journeys = _schema(engine)
    migration = _load_migration()
    older = datetime(2026, 9, 1, tzinfo=timezone.utc)
    newer = datetime(2026, 10, 1, tzinfo=timezone.utc)

    with engine.begin() as connection:
        connection.execute(
            preferences.insert(),
            [
                {"user_id": 1, "dismissed": False, "initial_setup_completed_at": older, "updated_at": older},
                {"user_id": 2, "dismissed": False, "initial_setup_completed_at": older, "updated_at": newer},
                {"user_id": 3, "dismissed": True, "initial_setup_completed_at": None, "updated_at": newer},
            ],
        )
        connection.execute(
            journeys.insert().values(
                id="00000000-0000-4000-8000-000000000002",
                user_id=2,
                revision=1,
                draft={"version": 2},
                resources={},
                pending_step=None,
                configured_at=None,
                created_at=newer,
                updated_at=newer,
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        assert "initial_setup_completed_at" not in {
            column["name"] for column in sa.inspect(connection).get_columns("onboarding_preferences")
        }
        rows = connection.execute(
            sa.select(journeys).order_by(journeys.c.user_id, journeys.c.id)
        ).mappings().all()
        assert [row["user_id"] for row in rows] == [1, 2]
        imported = rows[0]
        assert imported["id"] == migration._canonical_journey_id(1)
        assert imported["configured_at"] == older
        assert imported["draft"] == migration._CANONICAL_DRAFT
        assert imported["resources"] == {}
        assert rows[1]["configured_at"] is None

        migration.downgrade()

        restored = connection.execute(
            sa.text(
                "SELECT user_id, initial_setup_completed_at FROM onboarding_preferences ORDER BY user_id"
            )
        ).all()
        assert restored[0][0] == 1 and restored[0][1] is not None
        assert restored[1][1] is None
        assert restored[2][1] is None
        assert connection.scalar(sa.select(sa.func.count()).select_from(journeys)) == 1
