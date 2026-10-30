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
        / "0214_structure_webauthn_transports.py"
    )
    spec = util.spec_from_file_location(
        "migration_0214_structure_webauthn_transports",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _legacy_schema(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "webauthn_credentials",
        metadata,
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "transports_json",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
    )


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("webauthn_credentials")
    }


def test_migration_materializes_structured_transports_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    credentials = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            credentials.insert(),
            [
                {"id": "platform", "transports_json": '["internal","hybrid"]'},
                {"id": "security-key", "transports_json": "[]"},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert _column_names(connection) == {"id", "transports"}
        reflected = sa.Table(
            "webauthn_credentials",
            sa.MetaData(),
            autoload_with=connection,
        )
        rows = connection.execute(
            sa.select(reflected).order_by(reflected.c.id)
        ).mappings().all()
        assert rows == [
            {"id": "platform", "transports": ["internal", "hybrid"]},
            {"id": "security-key", "transports": []},
        ]

        migration.downgrade()

        assert _column_names(connection) == {"id", "transports_json"}
        restored = connection.execute(
            sa.text(
                "SELECT id, transports_json FROM webauthn_credentials ORDER BY id"
            )
        ).mappings().all()
        assert [
            {"id": row["id"], "transports": json.loads(row["transports_json"])}
            for row in restored
        ] == [
            {"id": "platform", "transports": ["internal", "hybrid"]},
            {"id": "security-key", "transports": []},
        ]


@pytest.mark.parametrize(
    "value",
    ["{", "{}", '"internal"', "null", '["internal",1]'],
)
def test_migration_rejects_invalid_or_non_string_transport_lists(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    credentials = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            credentials.insert().values(id="invalid", transports_json=value)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="WebAuthn credential invalid transports_json"):
            migration.upgrade()
