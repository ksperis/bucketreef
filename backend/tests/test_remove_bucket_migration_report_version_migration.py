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
        / "0175_remove_bucket_migration_report_version.py"
    )
    spec = util.spec_from_file_location(
        "migration_0175_remove_bucket_migration_report_version",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_report_version_and_restores_previous_version(monkeypatch):
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
        sa.Column("execution_plan_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            {
                "id": 1,
                "precheck_report_json": json.dumps(
                    {"report_version": 2, "status": "passed", "items": []}
                ),
            },
        )
        connection.execute(
            items.insert(),
            {
                "id": 10,
                "execution_plan_json": json.dumps(
                    {
                        "report_version": 2,
                        "strategy": "current_only",
                        "supported": True,
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

        report = json.loads(
            connection.execute(
                sa.text("SELECT precheck_report_json FROM bucket_migrations WHERE id = 1")
            ).scalar_one()
        )
        plan = json.loads(
            connection.execute(
                sa.text(
                    "SELECT execution_plan_json FROM bucket_migration_items WHERE id = 10"
                )
            ).scalar_one()
        )
        assert "report_version" not in report
        assert report["status"] == "passed"
        assert "report_version" not in plan
        assert plan["strategy"] == "current_only"

        migration.downgrade()

        restored_report = json.loads(
            connection.execute(
                sa.text("SELECT precheck_report_json FROM bucket_migrations WHERE id = 1")
            ).scalar_one()
        )
        restored_plan = json.loads(
            connection.execute(
                sa.text(
                    "SELECT execution_plan_json FROM bucket_migration_items WHERE id = 10"
                )
            ).scalar_one()
        )
        assert restored_report["report_version"] == 3
        assert restored_plan["report_version"] == 3
