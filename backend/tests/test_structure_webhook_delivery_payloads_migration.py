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
        / "0216_structure_webhook_delivery_payloads.py"
    )
    spec = util.spec_from_file_location(
        "migration_0216_structure_webhook_delivery_payloads",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _legacy_schema(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "webhook_deliveries",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payload_json", sa.Text(), nullable=False),
    )


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("webhook_deliveries")
    }


def test_migration_materializes_structured_webhook_payload_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    deliveries = _legacy_schema(metadata)
    metadata.create_all(engine)
    payload = {
        "id": "event-1",
        "type": "audit.admin.update_ui_user",
        "version": 1,
        "occurred_at": "2026-10-30T12:34:56+00:00",
        "data": {"label": "é", "count": 2},
    }

    with engine.begin() as connection:
        connection.execute(
            deliveries.insert().values(
                id=1,
                payload_json=json.dumps(payload, ensure_ascii=True, sort_keys=True),
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert _column_names(connection) == {"id", "payload"}
        structured = sa.Table(
            "webhook_deliveries",
            sa.MetaData(),
            autoload_with=connection,
        )
        row = connection.execute(sa.select(structured)).mappings().one()
        assert row["payload"] == payload

        migration.downgrade()

        assert _column_names(connection) == {"id", "payload_json"}
        restored = connection.execute(
            sa.text("SELECT payload_json FROM webhook_deliveries WHERE id = 1")
        ).scalar_one()
        assert restored == json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )


@pytest.mark.parametrize("value", ["{", "[]", '"legacy"', "null"])
def test_migration_rejects_invalid_or_non_object_payload(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    deliveries = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(deliveries.insert().values(id=1, payload_json=value))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Webhook delivery 1 payload_json"):
            migration.upgrade()


def test_migration_rejects_null_payload() -> None:
    migration = _load_migration()

    with pytest.raises(ValueError, match="Webhook delivery 1 payload_json"):
        migration._load_payload(1, None)
