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
        / "0208_structure_portal_request_payloads.py"
    )
    spec = util.spec_from_file_location(
        "migration_0208_structure_portal_request_payloads",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _requests(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "portal_admin_requests",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=True),
    )


def test_migration_materializes_structured_objects_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    requests = _requests(metadata)
    metadata.create_all(engine)
    payload = {"target_email": "member@example.test", "portal_role": "portal_user"}
    result = {"created_user": True}

    with engine.begin() as connection:
        connection.execute(
            requests.insert().values(
                id=1,
                payload_json=json.dumps(payload),
                result_json=json.dumps(result),
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
            for column in sa.inspect(connection).get_columns("portal_admin_requests")
        }
        assert "payload" in columns
        assert "result" in columns
        assert "payload_json" not in columns
        row = connection.execute(
            sa.text("SELECT payload, result FROM portal_admin_requests WHERE id = 1")
        ).one()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(row.payload) == payload
        assert processor(row.result) == result

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("portal_admin_requests")
        }
        assert "payload" not in columns
        assert "result" not in columns
        assert "payload_json" in columns
        restored = connection.execute(
            sa.text(
                "SELECT payload_json, result_json FROM portal_admin_requests WHERE id = 1"
            )
        ).one()
        assert json.loads(restored.payload_json) == payload
        assert json.loads(restored.result_json) == result


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("payload_json", "{"),
        ("payload_json", "[]"),
        ("result_json", "{"),
        ("result_json", "[]"),
    ],
)
def test_migration_rejects_invalid_objects(monkeypatch, field, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    requests = _requests(metadata)
    metadata.create_all(engine)
    values = {
        "id": 1,
        "payload_json": json.dumps({"target_email": "member@example.test"}),
        "result_json": json.dumps({"created_user": True}),
        field: value,
    }

    with engine.begin() as connection:
        connection.execute(requests.insert().values(**values))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Portal request 1"):
            migration.upgrade()
