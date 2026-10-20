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
        / "0177_remove_bucket_migration_plan_safety.py"
    )
    spec = util.spec_from_file_location(
        "migration_0177_remove_bucket_migration_plan_safety",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_plan_safety_and_restores_it_from_precheck(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
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
        sa.Column("migration_id", sa.Integer(), nullable=False),
        sa.Column("execution_plan_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            {
                "id": 1,
                "precheck_report_json": json.dumps(
                    {
                        "items": [
                            {
                                "item_id": 10,
                                "delete_source_safe": False,
                                "rollback_safe": True,
                                "same_endpoint_copy_safe": False,
                            }
                        ]
                    }
                ),
            },
        )
        connection.execute(
            items.insert(),
            {
                "id": 10,
                "migration_id": 1,
                "execution_plan_json": json.dumps(
                    {
                        "strategy": "current_only",
                        "supported": True,
                        "delete_source_safe": True,
                        "rollback_safe": False,
                        "same_endpoint_copy_safe": True,
                        "blocking_codes": [],
                    }
                ),
            },
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        plan = json.loads(
            connection.execute(
                sa.text(
                    "SELECT execution_plan_json FROM bucket_migration_items WHERE id = 10"
                )
            ).scalar_one()
        )
        assert all(field not in plan for field in migration._SAFETY_FIELDS)
        assert plan["strategy"] == "current_only"
        assert plan["supported"] is True

        migration.downgrade()

        restored = json.loads(
            connection.execute(
                sa.text(
                    "SELECT execution_plan_json FROM bucket_migration_items WHERE id = 10"
                )
            ).scalar_one()
        )
        assert restored["delete_source_safe"] is False
        assert restored["rollback_safe"] is True
        assert restored["same_endpoint_copy_safe"] is False
