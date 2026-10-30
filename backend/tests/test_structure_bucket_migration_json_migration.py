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
        / "0213_structure_bucket_migration_json.py"
    )
    spec = util.spec_from_file_location(
        "migration_0213_structure_bucket_migration_json",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _legacy_schema(metadata: sa.MetaData):
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("precheck_report_json", sa.Text(), nullable=True),
    )
    items = sa.Table(
        "bucket_migration_items",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("preparation_effects_json", sa.Text(), nullable=True),
        sa.Column("cleanup_verification_json", sa.Text(), nullable=True),
        sa.Column("diff_sample_json", sa.Text(), nullable=True),
        sa.Column("source_snapshot_json", sa.Text(), nullable=True),
        sa.Column("target_snapshot_json", sa.Text(), nullable=True),
        sa.Column("replication_state_json", sa.Text(), nullable=True),
        sa.Column("source_policy_backup_json", sa.Text(), nullable=True),
        sa.Column("target_policy_backup_json", sa.Text(), nullable=True),
    )
    events = sa.Table(
        "bucket_migration_events",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
    )
    return migrations, items, events


def _column_names(connection, table_name: str) -> set[str]:
    return {
        column["name"] for column in sa.inspect(connection).get_columns(table_name)
    }


def test_migration_materializes_structured_bucket_migration_state_and_downgrades(
    monkeypatch,
):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations, items, events = _legacy_schema(metadata)
    metadata.create_all(engine)

    migration_payload = {"status": "passed", "errors": 0}
    item_payloads = {
        "preparation_effects_json": {"probe_bucket": {"bucket": "probe"}},
        "cleanup_verification_json": {"target_sha256": "deadbeef"},
        "diff_sample_json": {"only_source": ["a"]},
        "source_snapshot_json": {"versioning": {"status": "Enabled"}},
        "target_snapshot_json": {"versioning": {"status": "Suspended"}},
        "replication_state_json": {"watermark": {"key": "value"}},
        "source_policy_backup_json": {"Version": "2012-10-17"},
        "target_policy_backup_json": {"Statement": []},
    }
    event_payload = {"operation": "cleanup_source", "attempt": 2}

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            [
                {"id": 1, "precheck_report_json": json.dumps(migration_payload)},
                {"id": 2, "precheck_report_json": None},
            ],
        )
        connection.execute(
            items.insert(),
            [
                {"id": 1, **{key: json.dumps(value) for key, value in item_payloads.items()}},
                {"id": 2, **{key: None for key in item_payloads}},
            ],
        )
        connection.execute(
            events.insert(),
            [
                {"id": 1, "metadata_json": json.dumps(event_payload)},
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

        assert _column_names(connection, "bucket_migrations") == {
            "id",
            "precheck_report",
        }
        assert _column_names(connection, "bucket_migration_items") == {
            "id",
            "preparation_effects",
            "cleanup_verification",
            "diff_sample",
            "source_snapshot",
            "target_snapshot",
            "replication_state",
            "source_policy_backup",
            "target_policy_backup",
        }
        assert _column_names(connection, "bucket_migration_events") == {
            "id",
            "metadata",
        }

        reflected = sa.MetaData()
        structured_migrations = sa.Table(
            "bucket_migrations", reflected, autoload_with=connection
        )
        structured_items = sa.Table(
            "bucket_migration_items", reflected, autoload_with=connection
        )
        structured_events = sa.Table(
            "bucket_migration_events", reflected, autoload_with=connection
        )
        migration_rows = connection.execute(
            sa.select(structured_migrations).order_by(structured_migrations.c.id)
        ).mappings().all()
        assert migration_rows[0]["precheck_report"] == migration_payload
        assert migration_rows[1]["precheck_report"] is None

        item_rows = connection.execute(
            sa.select(structured_items).order_by(structured_items.c.id)
        ).mappings().all()
        for legacy_name, expected in item_payloads.items():
            assert item_rows[0][legacy_name.removesuffix("_json")] == expected
            assert item_rows[1][legacy_name.removesuffix("_json")] is None

        event_rows = connection.execute(
            sa.select(structured_events).order_by(structured_events.c.id)
        ).mappings().all()
        assert event_rows[0]["metadata"] == event_payload
        assert event_rows[1]["metadata"] is None

        migration.downgrade()

        assert _column_names(connection, "bucket_migrations") == {
            "id",
            "precheck_report_json",
        }
        assert _column_names(connection, "bucket_migration_events") == {
            "id",
            "metadata_json",
        }
        restored_migration = connection.execute(
            sa.text(
                "SELECT id, precheck_report_json FROM bucket_migrations ORDER BY id"
            )
        ).mappings().all()
        assert json.loads(restored_migration[0]["precheck_report_json"]) == migration_payload
        assert restored_migration[1]["precheck_report_json"] is None

        restored_items = connection.execute(
            sa.text("SELECT * FROM bucket_migration_items ORDER BY id")
        ).mappings().all()
        for legacy_name, expected in item_payloads.items():
            assert json.loads(restored_items[0][legacy_name]) == expected
            assert restored_items[1][legacy_name] is None

        restored_events = connection.execute(
            sa.text("SELECT id, metadata_json FROM bucket_migration_events ORDER BY id")
        ).mappings().all()
        assert json.loads(restored_events[0]["metadata_json"]) == event_payload
        assert restored_events[1]["metadata_json"] is None


@pytest.mark.parametrize("value", ["{", "[]", '"legacy"', "null"])
def test_migration_rejects_invalid_or_non_object_json(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations, items, events = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert().values(id=1, precheck_report_json=value)
        )
        connection.execute(items.insert().values(id=1))
        connection.execute(events.insert().values(id=1))
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="bucket_migrations row 1 precheck_report_json"):
            migration.upgrade()
