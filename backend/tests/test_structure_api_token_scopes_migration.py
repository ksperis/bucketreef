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
        / "0202_structure_api_token_scopes.py"
    )
    spec = util.spec_from_file_location(
        "migration_0202_structure_api_token_scopes",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _api_tokens(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "api_tokens",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("scopes_json", sa.Text(), nullable=False, server_default="[]"),
    )


def test_migration_materializes_structured_scopes_and_drops_text(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tokens = _api_tokens(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            tokens.insert(),
            [
                {
                    "id": "token-1",
                    "scopes_json": json.dumps(["profile:read", "admin:read"]),
                },
                {"id": "token-2", "scopes_json": "[]"},
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
            for column in sa.inspect(connection).get_columns("api_tokens")
        }
        assert "scopes" in columns
        assert "scopes_json" not in columns
        rows = connection.execute(
            sa.text("SELECT id, scopes FROM api_tokens ORDER BY id")
        ).all()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(rows[0].scopes) == ["profile:read", "admin:read"]
        assert processor(rows[1].scopes) == []

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("api_tokens")
        }
        assert "scopes" not in columns
        assert "scopes_json" in columns
        restored = connection.execute(
            sa.text("SELECT scopes_json FROM api_tokens WHERE id = 'token-1'")
        ).scalar_one()
        assert json.loads(restored) == ["profile:read", "admin:read"]


@pytest.mark.parametrize(
    "scopes_json",
    [
        "{",
        "{}",
        "null",
        json.dumps(["profile:read", 42]),
    ],
)
def test_migration_rejects_invalid_scope_payloads(monkeypatch, scopes_json):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    tokens = _api_tokens(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            tokens.insert().values(id="token-1", scopes_json=scopes_json)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="API token token-1 scopes_json"):
            migration.upgrade()
