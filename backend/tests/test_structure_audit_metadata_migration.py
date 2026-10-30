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
        / "0215_structure_audit_metadata.py"
    )
    spec = util.spec_from_file_location(
        "migration_0215_structure_audit_metadata",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _legacy_schema(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "audit_logs",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
    )


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("audit_logs")
    }


def test_migration_materializes_structured_audit_metadata_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    logs = _legacy_schema(metadata)
    metadata.create_all(engine)
    payload = {"execution": "delegated", "attempt": 2}

    with engine.begin() as connection:
        connection.execute(
            logs.insert(),
            [
                {"id": 1, "metadata_json": json.dumps(payload)},
                {"id": 2, "metadata_json": None},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert _column_names(connection) == {"id", "metadata"}
        structured = sa.Table(
            "audit_logs",
            sa.MetaData(),
            autoload_with=connection,
        )
        rows = connection.execute(
            sa.select(structured).order_by(structured.c.id)
        ).mappings().all()
        assert rows[0]["metadata"] == payload
        assert rows[1]["metadata"] is None

        migration.downgrade()

        assert _column_names(connection) == {"id", "metadata_json"}
        restored = connection.execute(
            sa.text("SELECT id, metadata_json FROM audit_logs ORDER BY id")
        ).mappings().all()
        assert json.loads(restored[0]["metadata_json"]) == payload
        assert restored[1]["metadata_json"] is None


@pytest.mark.parametrize("value", ["{", "[]", '"legacy"', "null"])
def test_migration_rejects_invalid_or_non_object_metadata(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    logs = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(logs.insert().values(id=1, metadata_json=value))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Audit log 1 metadata_json"):
            migration.upgrade()
