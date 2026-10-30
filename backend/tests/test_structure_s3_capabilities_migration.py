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
        / "0219_structure_s3_capabilities.py"
    )
    spec = util.spec_from_file_location("migration_0219_structure_s3_capabilities", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _legacy_schema(metadata: sa.MetaData) -> tuple[sa.Table, sa.Table]:
    connections = sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "capabilities_json",
            sa.Text(),
            nullable=False,
            server_default='{"can_manage_iam":false}',
        ),
    )
    sessions = sa.Table(
        "s3_sessions",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("capabilities", sa.Text(), nullable=False),
    )
    return connections, sessions


def _columns(connection, table: str) -> dict[str, dict]:
    return {
        column["name"]: column
        for column in sa.inspect(connection).get_columns(table)
    }


def test_migration_structures_s3_capabilities_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    connections, sessions = _legacy_schema(metadata)
    metadata.create_all(engine)
    connection_capabilities = {
        "can_manage_iam": True,
        "region_probe": "ok",
    }
    session_capabilities = {
        "can_manage_iam": True,
        "can_manage_buckets": True,
        "can_view_traffic": False,
        "access_browser": True,
        "endpoint_url": "https://s3.example.test",
    }

    with engine.begin() as connection:
        connection.execute(
            connections.insert().values(
                id=1,
                capabilities_json=json.dumps(connection_capabilities),
            )
        )
        connection.execute(
            sessions.insert().values(
                id="session-1",
                capabilities=json.dumps(session_capabilities),
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        connection_columns = _columns(connection, "s3_connections")
        session_columns = _columns(connection, "s3_sessions")
        assert "capabilities_json" not in connection_columns
        assert isinstance(connection_columns["capabilities"]["type"], sa.JSON)
        assert connection_columns["capabilities"]["nullable"] is False
        assert isinstance(session_columns["capabilities"]["type"], sa.JSON)
        assert session_columns["capabilities"]["nullable"] is False

        structured_connections = sa.Table(
            "s3_connections",
            sa.MetaData(),
            autoload_with=connection,
        )
        structured_sessions = sa.Table(
            "s3_sessions",
            sa.MetaData(),
            autoload_with=connection,
        )
        assert connection.execute(
            sa.select(structured_connections.c.capabilities)
        ).scalar_one() == connection_capabilities
        assert connection.execute(
            sa.select(structured_sessions.c.capabilities)
        ).scalar_one() == session_capabilities

        migration.downgrade()

        downgraded_connections = _columns(connection, "s3_connections")
        downgraded_sessions = _columns(connection, "s3_sessions")
        assert "capabilities" not in downgraded_connections
        assert isinstance(downgraded_connections["capabilities_json"]["type"], sa.Text)
        assert isinstance(downgraded_sessions["capabilities"]["type"], sa.Text)
        assert json.loads(
            connection.execute(
                sa.text("SELECT capabilities_json FROM s3_connections WHERE id = 1")
            ).scalar_one()
        ) == connection_capabilities
        assert json.loads(
            connection.execute(
                sa.text("SELECT capabilities FROM s3_sessions WHERE id = 'session-1'")
            ).scalar_one()
        ) == session_capabilities


@pytest.mark.parametrize(
    "value",
    ["{", "[]", "{}", '{"can_manage_iam":1}', '{"iam_capable":true}', "null"],
)
def test_migration_rejects_invalid_connection_capabilities(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    connections, _sessions = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert().values(id=1, capabilities_json=value)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="S3 connection 1 capabilities"):
            migration.upgrade()


@pytest.mark.parametrize(
    "value",
    [
        "{",
        "[]",
        "{}",
        "null",
        json.dumps(
            {
                "can_manage_iam": 1,
                "can_manage_buckets": True,
                "can_view_traffic": False,
                "access_browser": True,
                "endpoint_url": None,
            }
        ),
        json.dumps(
            {
                "can_manage_iam": False,
                "can_manage_buckets": True,
                "can_view_traffic": False,
                "access_browser": True,
                "endpoint_url": 42,
            }
        ),
    ],
)
def test_migration_rejects_invalid_session_capabilities(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    _connections, sessions = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            sessions.insert().values(id="session-1", capabilities=value)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="S3 session session-1 capabilities"):
            migration.upgrade()
