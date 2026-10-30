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
        / "0218_structure_cost_measurement_breakdowns.py"
    )
    spec = util.spec_from_file_location(
        "migration_0218_structure_cost_measurement_breakdowns",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _legacy_schema(metadata: sa.MetaData) -> tuple[sa.Table, sa.Table]:
    usage = sa.Table(
        "cost_usage_daily",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ops_breakdown", sa.Text(), nullable=True),
    )
    storage = sa.Table(
        "cost_storage_daily",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("by_bucket", sa.Text(), nullable=True),
    )
    return usage, storage


def _column_type(connection, table: str, column_name: str) -> sa.types.TypeEngine:
    column = next(
        item
        for item in sa.inspect(connection).get_columns(table)
        if item["name"] == column_name
    )
    return column["type"]


def test_migration_materializes_structured_cost_breakdowns_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    usage, storage = _legacy_schema(metadata)
    metadata.create_all(engine)
    ops_breakdown = {"get": 12, "put": 3}
    by_bucket = {
        "bucket-a": {"used_bytes": 42, "object_count": 2},
        "bucket-b": {"used_bytes": 0, "object_count": 0},
    }

    with engine.begin() as connection:
        connection.execute(
            usage.insert(),
            [
                {"id": 1, "ops_breakdown": json.dumps(ops_breakdown)},
                {"id": 2, "ops_breakdown": "{}"},
                {"id": 3, "ops_breakdown": None},
            ],
        )
        connection.execute(
            storage.insert(),
            [
                {"id": 1, "by_bucket": json.dumps(by_bucket)},
                {"id": 2, "by_bucket": "{}"},
                {"id": 3, "by_bucket": None},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert isinstance(
            _column_type(connection, "cost_usage_daily", "ops_breakdown"),
            sa.JSON,
        )
        assert isinstance(
            _column_type(connection, "cost_storage_daily", "by_bucket"),
            sa.JSON,
        )
        structured_usage = sa.Table(
            "cost_usage_daily",
            sa.MetaData(),
            autoload_with=connection,
        )
        structured_storage = sa.Table(
            "cost_storage_daily",
            sa.MetaData(),
            autoload_with=connection,
        )
        usage_rows = connection.execute(
            sa.select(structured_usage).order_by(structured_usage.c.id)
        ).mappings().all()
        storage_rows = connection.execute(
            sa.select(structured_storage).order_by(structured_storage.c.id)
        ).mappings().all()
        assert usage_rows[0]["ops_breakdown"] == ops_breakdown
        assert usage_rows[1]["ops_breakdown"] is None
        assert usage_rows[2]["ops_breakdown"] is None
        assert storage_rows[0]["by_bucket"] == by_bucket
        assert storage_rows[1]["by_bucket"] is None
        assert storage_rows[2]["by_bucket"] is None

        migration.downgrade()

        assert isinstance(
            _column_type(connection, "cost_usage_daily", "ops_breakdown"),
            sa.Text,
        )
        assert isinstance(
            _column_type(connection, "cost_storage_daily", "by_bucket"),
            sa.Text,
        )
        restored_usage = connection.execute(
            sa.text("SELECT id, ops_breakdown FROM cost_usage_daily ORDER BY id")
        ).mappings().all()
        restored_storage = connection.execute(
            sa.text("SELECT id, by_bucket FROM cost_storage_daily ORDER BY id")
        ).mappings().all()
        assert restored_usage[0]["ops_breakdown"] == json.dumps(
            ops_breakdown,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        assert restored_usage[1]["ops_breakdown"] is None
        assert restored_usage[2]["ops_breakdown"] is None
        assert restored_storage[0]["by_bucket"] == json.dumps(
            by_bucket,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        assert restored_storage[1]["by_bucket"] is None
        assert restored_storage[2]["by_bucket"] is None


@pytest.mark.parametrize(
    "value",
    ["{", "[]", '"legacy"', "null", '{"get":"12"}', '{"get":true}'],
)
def test_migration_rejects_invalid_usage_breakdown(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    usage, _storage = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(usage.insert().values(id=1, ops_breakdown=value))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Cost usage row 1 ops_breakdown"):
            migration.upgrade()


@pytest.mark.parametrize(
    "value",
    [
        "{",
        "[]",
        '"legacy"',
        "null",
        '{"bucket":[]}',
        '{"bucket":{"used_bytes":"1","object_count":2}}',
        '{"bucket":{"used_bytes":1}}',
        '{"bucket":{"used_bytes":1,"object_count":2,"extra":3}}',
    ],
)
def test_migration_rejects_invalid_bucket_breakdown(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    _usage, storage = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(storage.insert().values(id=1, by_bucket=value))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Cost storage row 1 by_bucket"):
            migration.upgrade()
