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


DISTRIBUTION_COLUMNS = (
    "data_type_distribution_json",
    "storage_class_distribution_json",
    "size_distribution_json",
    "age_distribution_json",
    "current_noncurrent_distribution_json",
)


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0207_structure_bucket_usage_stats_payloads.py"
    )
    spec = util.spec_from_file_location(
        "migration_0207_structure_bucket_usage_stats_payloads",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _snapshots(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "bucket_usage_stats_snapshots",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        *[sa.Column(name, sa.Text(), nullable=False) for name in DISTRIBUTION_COLUMNS],
        sa.Column("warnings_json", sa.Text(), nullable=True),
    )


def _row(**overrides):
    values = {
        "id": 1,
        **{name: "[]" for name in DISTRIBUTION_COLUMNS},
        "warnings_json": json.dumps(["partial"]),
    }
    values.update(overrides)
    return values


def test_migration_materializes_structured_lists_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    snapshots = _snapshots(metadata)
    metadata.create_all(engine)
    entry = {"label": "Images", "count": 2, "bytes": 20}

    with engine.begin() as connection:
        connection.execute(
            snapshots.insert().values(
                **_row(data_type_distribution_json=json.dumps([entry]))
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_usage_stats_snapshots")}
        assert "data_type_distribution" in columns
        assert "data_type_distribution_json" not in columns
        row = connection.execute(
            sa.text("SELECT data_type_distribution, warnings FROM bucket_usage_stats_snapshots WHERE id = 1")
        ).one()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(row.data_type_distribution) == [entry]
        assert processor(row.warnings) == ["partial"]

        migration.downgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_usage_stats_snapshots")}
        assert "data_type_distribution" not in columns
        assert "data_type_distribution_json" in columns
        restored = connection.execute(
            sa.text("SELECT data_type_distribution_json, warnings_json FROM bucket_usage_stats_snapshots WHERE id = 1")
        ).one()
        assert json.loads(restored.data_type_distribution_json) == [entry]
        assert json.loads(restored.warnings_json) == ["partial"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("data_type_distribution_json", "{"),
        ("storage_class_distribution_json", "{}"),
        ("size_distribution_json", "[1]"),
        ("warnings_json", "[1]"),
    ],
)
def test_migration_rejects_invalid_payloads(monkeypatch, field, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    snapshots = _snapshots(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(snapshots.insert().values(**_row(**{field: value})))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="Bucket usage snapshot 1"):
            migration.upgrade()
