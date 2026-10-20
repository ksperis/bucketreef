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
        / "0172_canonical_bucket_migration_checks.py"
    )
    spec = util.spec_from_file_location(
        "migration_0172_canonical_bucket_migration_checks",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_precheck_diagnostics_and_restores_alias_on_downgrade(
    monkeypatch,
):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("precheck_report_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    canonical_check = {"code": "canonical", "message": "Current diagnostic"}
    legacy_check = {"code": "legacy", "message": "Legacy diagnostic"}
    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            [
                {
                    "id": 1,
                    "precheck_report_json": json.dumps(
                        {
                            "items": [
                                {
                                    "item_id": 10,
                                    "checks": [canonical_check],
                                    "messages": [legacy_check],
                                }
                            ]
                        }
                    ),
                },
                {
                    "id": 2,
                    "precheck_report_json": json.dumps(
                        {"items": [{"item_id": 20, "messages": [legacy_check]}]}
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
                "SELECT id, precheck_report_json FROM bucket_migrations ORDER BY id"
            )
        ).mappings().all()
        first = json.loads(rows[0]["precheck_report_json"])
        second = json.loads(rows[1]["precheck_report_json"])
        assert first["items"][0]["checks"] == [canonical_check]
        assert second["items"][0]["checks"] == [legacy_check]
        assert "messages" not in first["items"][0]
        assert "messages" not in second["items"][0]

        migration.downgrade()

        restored_rows = connection.execute(
            sa.text(
                "SELECT id, precheck_report_json FROM bucket_migrations ORDER BY id"
            )
        ).mappings().all()
        for row in restored_rows:
            item = json.loads(row["precheck_report_json"])["items"][0]
            assert item["messages"] == item["checks"]
