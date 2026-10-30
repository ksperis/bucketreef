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
        / "0204_structure_auth_challenge_payloads.py"
    )
    spec = util.spec_from_file_location(
        "migration_0204_structure_auth_challenge_payloads",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _auth_challenges(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "auth_challenges",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
    )


def test_migration_materializes_structured_payload_and_drops_text(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    challenges = _auth_challenges(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            challenges.insert(),
            [
                {
                    "id": "challenge-1",
                    "payload_json": json.dumps({"challenge": "encoded"}),
                },
                {"id": "challenge-2", "payload_json": "{}"},
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
            for column in sa.inspect(connection).get_columns("auth_challenges")
        }
        assert "payload" in columns
        assert "payload_json" not in columns
        rows = connection.execute(
            sa.text("SELECT id, payload FROM auth_challenges ORDER BY id")
        ).all()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(rows[0].payload) == {"challenge": "encoded"}
        assert processor(rows[1].payload) == {}

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("auth_challenges")
        }
        assert "payload" not in columns
        assert "payload_json" in columns
        restored = connection.execute(
            sa.text(
                "SELECT payload_json FROM auth_challenges WHERE id = 'challenge-1'"
            )
        ).scalar_one()
        assert json.loads(restored) == {"challenge": "encoded"}


@pytest.mark.parametrize("payload_json", ["{", "[]", "null"])
def test_migration_rejects_non_object_or_invalid_payloads(monkeypatch, payload_json):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    challenges = _auth_challenges(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            challenges.insert().values(id="challenge-1", payload_json=payload_json)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(
            ValueError,
            match="Authentication challenge challenge-1 payload_json",
        ):
            migration.upgrade()
