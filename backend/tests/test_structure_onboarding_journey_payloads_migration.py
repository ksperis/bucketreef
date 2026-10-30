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
        / "0206_structure_onboarding_journey_payloads.py"
    )
    spec = util.spec_from_file_location(
        "migration_0206_structure_onboarding_journey_payloads",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _journeys(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "onboarding_journeys",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("draft_json", sa.Text(), nullable=False),
        sa.Column("resources_json", sa.Text(), nullable=False),
    )


def test_migration_materializes_structured_objects_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    journeys = _journeys(metadata)
    metadata.create_all(engine)

    draft = {"version": 2, "manager": True}
    resources = {"endpoint_id": 7}
    with engine.begin() as connection:
        connection.execute(
            journeys.insert().values(
                id="journey-1",
                draft_json=json.dumps(draft),
                resources_json=json.dumps(resources),
            )
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
            for column in sa.inspect(connection).get_columns("onboarding_journeys")
        }
        assert {"draft", "resources"}.issubset(columns)
        assert {"draft_json", "resources_json"}.isdisjoint(columns)
        row = connection.execute(
            sa.text("SELECT draft, resources FROM onboarding_journeys WHERE id = 'journey-1'")
        ).one()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(row.draft) == draft
        assert processor(row.resources) == resources

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("onboarding_journeys")
        }
        assert {"draft", "resources"}.isdisjoint(columns)
        assert {"draft_json", "resources_json"}.issubset(columns)
        restored = connection.execute(
            sa.text(
                "SELECT draft_json, resources_json FROM onboarding_journeys "
                "WHERE id = 'journey-1'"
            )
        ).one()
        assert json.loads(restored.draft_json) == draft
        assert json.loads(restored.resources_json) == resources


@pytest.mark.parametrize(
    ("draft_json", "resources_json"),
    [
        ("{", "{}"),
        ("[]", "{}"),
        ("{}", "null"),
    ],
)
def test_migration_rejects_invalid_or_non_object_payloads(
    monkeypatch,
    draft_json,
    resources_json,
):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    journeys = _journeys(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            journeys.insert().values(
                id="journey-1",
                draft_json=draft_json,
                resources_json=resources_json,
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Onboarding journey journey-1"):
            migration.upgrade()
