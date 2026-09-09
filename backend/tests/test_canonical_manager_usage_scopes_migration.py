# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _install_migration(connection):
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0124_canonical_manager_usage_scopes.py"
    spec = util.spec_from_file_location("migration_0124_canonical_manager_usage_scopes", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    migration.op = Operations(MigrationContext.configure(connection))
    return migration


@pytest.fixture
def snapshots_db():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    snapshots = sa.Table(
        "bucket_usage_stats_snapshots", metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scope_kind", sa.String(), nullable=False),
        sa.Column("scope_id", sa.String(), nullable=False),
        sa.Column("bucket_name", sa.String(), nullable=False),
        sa.Column("calculated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_bytes", sa.Integer(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=False),
        sa.UniqueConstraint("scope_kind", "scope_id", "bucket_name"),
    )
    metadata.create_all(engine)
    try:
        with engine.begin() as connection:
            yield connection, snapshots
    finally:
        engine.dispose()


def _row(row_id, scope_id, *, scope_kind="manager", bucket_name="bucket-a", calculated=0, updated=0):
    timestamp = datetime(2026, 9, 9, tzinfo=timezone.utc)
    return {
        "id": row_id, "scope_kind": scope_kind, "scope_id": scope_id,
        "bucket_name": bucket_name,
        "calculated_at": timestamp + timedelta(hours=calculated),
        "updated_at": timestamp + timedelta(hours=updated),
        "total_bytes": 10 * row_id, "warnings_json": '["Listing unavailable"]',
    }


@pytest.mark.parametrize("scope_id, canonical", [
    ("0001", "1"), (" +0002 ", "2"), ("1_0", "10"), ("１２", "12"),
    ("conn-0008", "conn-8"), ("s3u-0003", "s3u-3"), ("conn-１２", "conn-12"),
])
def test_migration_canonicalizes_manager_selectors(snapshots_db, scope_id, canonical):
    connection, snapshots = snapshots_db
    connection.execute(snapshots.insert(), _row(1, scope_id))
    original = dict(connection.execute(sa.select(snapshots)).one()._mapping)
    migration = _install_migration(connection)

    migration.upgrade()
    migration.upgrade()

    assert dict(connection.execute(sa.select(snapshots)).one()._mapping) == {
        **original, "scope_id": canonical,
    }


@pytest.mark.parametrize("scope_id", [
    "1", "conn-8", "s3u-3", "session:0001", "ceph-admin-0001", "legacy-scope",
    "", "null", "-1", "0", "conn-", "conn-+1", "conn- 1", "s3u-1_0", "conn-²",
])
def test_migration_preserves_canonical_sessions_unknown_and_other_surfaces(snapshots_db, scope_id):
    connection, snapshots = snapshots_db
    connection.execute(snapshots.insert(), [
        _row(1, scope_id),
        _row(2, "0001", scope_kind="ceph_admin"),
        _row(3, "0001", scope_kind="storage_ops"),
    ])
    original = connection.execute(sa.select(snapshots).order_by(snapshots.c.id)).all()

    _install_migration(connection).upgrade()

    assert connection.execute(sa.select(snapshots).order_by(snapshots.c.id)).all() == original


@pytest.mark.parametrize("winner", ["canonical", "alias"])
def test_migration_merges_only_duplicate_scope_buckets_using_newest_calculation(snapshots_db, winner):
    connection, snapshots = snapshots_db
    canonical_wins = winner == "canonical"
    connection.execute(snapshots.insert(), [
        _row(1, "1", calculated=2 if canonical_wins else 0, updated=9),
        _row(2, "001", calculated=0 if canonical_wins else 2, updated=0),
        _row(3, "0001", calculated=1, updated=10),
        _row(4, "0001", bucket_name="bucket-b"),
        _row(5, "conn-0001"),
        _row(6, "s3u-0001"),
        _row(7, "2"),
        _row(8, "0001", scope_kind="ceph_admin"),
    ])
    original = {row.id: dict(row._mapping) for row in connection.execute(sa.select(snapshots))}
    migration = _install_migration(connection)

    migration.upgrade()
    migration.upgrade()

    expected_scopes = {1 if canonical_wins else 2: "1", 4: "1", 5: "conn-1", 6: "s3u-1", 7: "2", 8: "0001"}
    assert [dict(row._mapping) for row in connection.execute(sa.select(snapshots).order_by(snapshots.c.id))] == [
        {**original[row_id], "scope_id": scope_id} for row_id, scope_id in expected_scopes.items()
    ]


def test_migration_breaks_timestamp_ties_by_update_time_then_id(snapshots_db):
    connection, snapshots = snapshots_db
    connection.execute(snapshots.insert(), [
        _row(1, "1", updated=1), _row(2, "01", updated=2), _row(3, "001", updated=2),
    ])
    migration = _install_migration(connection)

    migration.upgrade()
    # Downgrade keeps the normalized latest snapshot, not stale duplicate cache entries.
    migration.downgrade()

    row = connection.execute(sa.select(snapshots)).one()
    assert row.id == 3
    assert row.scope_id == "1"
    assert row.total_bytes == 30


def test_migration_accepts_empty_snapshot_store(snapshots_db):
    connection, snapshots = snapshots_db
    _install_migration(connection).upgrade()
    assert connection.execute(sa.select(snapshots)).all() == []
