# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0239_canonical_bucket_migration_rollback_status.py"
    )
    spec = util.spec_from_file_location(
        "migration_0239_canonical_bucket_migration_rollback_status",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_retired_rollback_statuses_and_counters(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("total_items", sa.Integer(), nullable=False),
        sa.Column("completed_items", sa.Integer(), nullable=False),
        sa.Column("failed_items", sa.Integer(), nullable=False),
        sa.Column("skipped_items", sa.Integer(), nullable=False),
        sa.Column("awaiting_items", sa.Integer(), nullable=False),
    )
    items = sa.Table(
        "bucket_migration_items",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("migration_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("step", sa.String(), nullable=False),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            [
                {
                    "id": 1,
                    "status": "rolled_back",
                    "total_items": 2,
                    "completed_items": 2,
                    "failed_items": 0,
                    "skipped_items": 0,
                    "awaiting_items": 0,
                },
                {
                    "id": 2,
                    "status": "completed",
                    "total_items": 2,
                    "completed_items": 2,
                    "failed_items": 0,
                    "skipped_items": 0,
                    "awaiting_items": 0,
                },
                {
                    "id": 3,
                    "status": "canceled",
                    "total_items": 1,
                    "completed_items": 7,
                    "failed_items": 0,
                    "skipped_items": 0,
                    "awaiting_items": 0,
                },
            ],
        )
        connection.execute(
            items.insert(),
            [
                {"id": 10, "migration_id": 1, "status": "rolled_back", "step": "rolled_back"},
                {"id": 11, "migration_id": 1, "status": "rolled_back", "step": "rolled_back"},
                {"id": 20, "migration_id": 2, "status": "completed", "step": "completed"},
                {"id": 21, "migration_id": 2, "status": "rolled_back", "step": "rolled_back"},
                {"id": 30, "migration_id": 3, "status": "canceled", "step": "sync"},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        migration_rows = connection.execute(
            sa.text(
                "SELECT id, status, total_items, completed_items, failed_items, "
                "skipped_items, awaiting_items FROM bucket_migrations ORDER BY id"
            )
        ).mappings().all()
        assert [dict(row) for row in migration_rows] == [
            {
                "id": 1,
                "status": "canceled",
                "total_items": 2,
                "completed_items": 0,
                "failed_items": 0,
                "skipped_items": 0,
                "awaiting_items": 0,
            },
            {
                "id": 2,
                "status": "completed",
                "total_items": 2,
                "completed_items": 1,
                "failed_items": 0,
                "skipped_items": 0,
                "awaiting_items": 0,
            },
            {
                "id": 3,
                "status": "canceled",
                "total_items": 1,
                "completed_items": 7,
                "failed_items": 0,
                "skipped_items": 0,
                "awaiting_items": 0,
            },
        ]
        item_rows = connection.execute(
            sa.text(
                "SELECT id, status, step FROM bucket_migration_items ORDER BY id"
            )
        ).mappings().all()
        assert [dict(row) for row in item_rows] == [
            {"id": 10, "status": "canceled", "step": "rolled_back"},
            {"id": 11, "status": "canceled", "step": "rolled_back"},
            {"id": 20, "status": "completed", "step": "completed"},
            {"id": 21, "status": "canceled", "step": "rolled_back"},
            {"id": 30, "status": "canceled", "step": "sync"},
        ]

        migration.downgrade()
        assert connection.scalar(
            sa.text("SELECT status FROM bucket_migrations WHERE id=1")
        ) == "canceled"
