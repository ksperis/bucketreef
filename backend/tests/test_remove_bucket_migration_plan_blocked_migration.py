# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0176_remove_bucket_migration_plan_blocked.py"
    )
    spec = util.spec_from_file_location(
        "migration_0176_remove_bucket_migration_plan_blocked",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_blocked_and_restores_it_from_supported(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    items = sa.Table(
        "bucket_migration_items",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("execution_plan_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            items.insert(),
            [
                {
                    "id": 1,
                    "execution_plan_json": json.dumps(
                        {
                            "strategy": "current_only",
                            "supported": True,
                            "blocked": True,
                        }
                    ),
                },
                {
                    "id": 2,
                    "execution_plan_json": json.dumps(
                        {
                            "strategy": "version_aware",
                            "supported": False,
                            "blocked": False,
                        }
                    ),
                },
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        plans = [
            json.loads(raw)
            for raw in connection.execute(
                sa.text(
                    "SELECT execution_plan_json FROM bucket_migration_items ORDER BY id"
                )
            ).scalars()
        ]
        assert all("blocked" not in plan for plan in plans)
        assert plans[0]["supported"] is True
        assert plans[1]["supported"] is False

        migration.downgrade()

        restored = [
            json.loads(raw)
            for raw in connection.execute(
                sa.text(
                    "SELECT execution_plan_json FROM bucket_migration_items ORDER BY id"
                )
            ).scalars()
        ]
        assert restored[0]["blocked"] is False
        assert restored[1]["blocked"] is True
