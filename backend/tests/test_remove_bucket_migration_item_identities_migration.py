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
        / "0174_remove_bucket_migration_item_identities.py"
    )
    spec = util.spec_from_file_location(
        "migration_0174_remove_bucket_migration_item_identities",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_item_identities_and_restores_them_from_migration(
    monkeypatch,
):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("source_context_id", sa.String(), nullable=False),
        sa.Column("target_context_id", sa.String(), nullable=False),
        sa.Column("precheck_report_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            {
                "id": 1,
                "source_context_id": "source-context",
                "target_context_id": "target-context",
                "precheck_report_json": json.dumps(
                    {
                        "items": [
                            {
                                "item_id": 10,
                                "source_identity": "stale-source",
                                "target_identity": "stale-target",
                                "checks": [],
                            },
                            {"item_id": 11, "checks": []},
                        ]
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
        for item in report["items"]:
            assert "source_identity" not in item
            assert "target_identity" not in item

        migration.downgrade()

        restored = json.loads(
            connection.execute(
                sa.text("SELECT precheck_report_json FROM bucket_migrations WHERE id = 1")
            ).scalar_one()
        )
        for item in restored["items"]:
            assert item["source_identity"] == "source-context"
            assert item["target_identity"] == "target-context"
