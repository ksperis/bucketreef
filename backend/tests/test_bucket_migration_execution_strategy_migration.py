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
        / "0179_bucket_migration_execution_strategy.py"
    )
    spec = util.spec_from_file_location(
        "migration_0179_bucket_migration_execution_strategy",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_replaces_plan_json_and_reconstructs_it_on_downgrade(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("precheck_status", sa.String(), nullable=True),
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
            [
                {
                    "id": 1,
                    "precheck_status": "passed",
                    "precheck_report_json": json.dumps(
                        {
                            "items": [
                                {
                                    "item_id": 10,
                                    "blocking": False,
                                    "checks": [],
                                }
                            ]
                        }
                    ),
                },
                {
                    "id": 2,
                    "precheck_status": "failed",
                    "precheck_report_json": json.dumps(
                        {
                            "items": [
                                {
                                    "item_id": 20,
                                    "blocking": True,
                                    "checks": [
                                        {
                                            "code": "destination_exists",
                                            "blocking": True,
                                        }
                                    ],
                                }
                            ]
                        }
                    ),
                },
            ],
        )
        connection.execute(
            items.insert(),
            [
                {
                    "id": 10,
                    "migration_id": 1,
                    "execution_plan_json": json.dumps(
                        {
                            "strategy": "current_only",
                            "supported": True,
                            "blocking_codes": [],
                        }
                    ),
                },
                {
                    "id": 20,
                    "migration_id": 2,
                    "execution_plan_json": json.dumps(
                        {
                            "strategy": "version_aware",
                            "supported": False,
                            "blocking_codes": ["destination_exists"],
                        }
                    ),
                },
                {
                    "id": 21,
                    "migration_id": 2,
                    "execution_plan_json": json.dumps({"supported": False}),
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

        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_migration_items")}
        assert "execution_strategy" in columns
        assert "execution_plan_json" not in columns
        strategies = dict(
            connection.execute(
                sa.text(
                    "SELECT id, execution_strategy "
                    "FROM bucket_migration_items ORDER BY id"
                )
            ).all()
        )
        assert strategies == {10: "current_only", 20: "version_aware", 21: None}

        migration.downgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_migration_items")}
        assert "execution_plan_json" in columns
        assert "execution_strategy" not in columns
        restored_rows = connection.execute(
            sa.text(
                "SELECT id, execution_plan_json "
                "FROM bucket_migration_items ORDER BY id"
            )
        ).all()
        restored = {
            item_id: json.loads(raw) if raw is not None else None
            for item_id, raw in restored_rows
        }
        assert restored[10] == {
            "strategy": "current_only",
            "supported": True,
            "blocking_codes": [],
        }
        assert restored[20] == {
            "strategy": "version_aware",
            "supported": False,
            "blocking_codes": ["destination_exists"],
        }
        assert restored[21] is None
