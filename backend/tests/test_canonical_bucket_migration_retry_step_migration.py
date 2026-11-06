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
        / "0237_canonical_bucket_migration_retry_step.py"
    )
    spec = util.spec_from_file_location(
        "migration_0237_canonical_bucket_migration_retry_step",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_only_replayable_rollback_failures(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("workflow_version", sa.Integer(), nullable=False),
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
                {"id": 1, "workflow_version": 2},
                {"id": 2, "workflow_version": 1},
            ],
        )
        connection.execute(
            items.insert(),
            [
                {"id": 10, "migration_id": 1, "status": "failed", "step": "rollback_failed"},
                {"id": 11, "migration_id": 1, "status": "failed", "step": "sync"},
                {"id": 12, "migration_id": 2, "status": "failed", "step": "rollback_failed"},
                {"id": 13, "migration_id": 1, "status": "completed", "step": "rollback_failed"},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        rows = connection.execute(
            sa.text("SELECT id, step FROM bucket_migration_items ORDER BY id")
        ).mappings().all()
        assert {row["id"]: row["step"] for row in rows} == {
            10: "sync",
            11: "sync",
            12: "rollback_failed",
            13: "rollback_failed",
        }

        migration.downgrade()
        assert connection.scalar(
            sa.text("SELECT step FROM bucket_migration_items WHERE id=10")
        ) == "sync"
