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
        / "0178_canonical_bucket_migration_plan_strategy.py"
    )
    spec = util.spec_from_file_location(
        "migration_0178_canonical_bucket_migration_plan_strategy",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_only_current_workflow_plans(monkeypatch):
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
        sa.Column("execution_plan_json", sa.Text(), nullable=True),
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
                {
                    "id": 10,
                    "migration_id": 1,
                    "execution_plan_json": json.dumps(
                        {"supported": True, "blocking_codes": []}
                    ),
                },
                {
                    "id": 11,
                    "migration_id": 1,
                    "execution_plan_json": json.dumps(
                        {
                            "strategy": " version_aware ",
                            "supported": True,
                            "blocking_codes": [],
                        }
                    ),
                },
                {
                    "id": 12,
                    "migration_id": 2,
                    "execution_plan_json": json.dumps(
                        {"supported": True, "blocking_codes": []}
                    ),
                },
                {
                    "id": 13,
                    "migration_id": 1,
                    "execution_plan_json": json.dumps(
                        {
                            "strategy": "   ",
                            "supported": True,
                            "blocking_codes": [],
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

        rows = connection.execute(
            sa.text(
                "SELECT id, execution_plan_json "
                "FROM bucket_migration_items ORDER BY id"
            )
        ).mappings().all()
        plans = {row["id"]: json.loads(row["execution_plan_json"]) for row in rows}
        assert plans[10]["strategy"] == "current_only"
        assert plans[11]["strategy"] == "version_aware"
        assert "strategy" not in plans[12]
        assert plans[13]["strategy"] == "current_only"

        migration.downgrade()

        restored = json.loads(
            connection.execute(
                sa.text(
                    "SELECT execution_plan_json "
                    "FROM bucket_migration_items WHERE id = 10"
                )
            ).scalar_one()
        )
        assert restored["strategy"] == "current_only"
