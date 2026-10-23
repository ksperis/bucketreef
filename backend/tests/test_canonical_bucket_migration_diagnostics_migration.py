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
        / "0182_canonical_bucket_migration_diagnostics.py"
    )
    spec = util.spec_from_file_location(
        "migration_0182_canonical_bucket_migration_diagnostics",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_nullable_diagnostic_fields(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("precheck_report_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            {
                "id": 1,
                "precheck_report_json": json.dumps(
                    {
                        "checks": [
                            {"code": "global", "remediation": "Fix it"},
                        ],
                        "items": [
                            {
                                "item_id": 10,
                                "checks": [
                                    {"code": "item", "details": {"attempt": 1}},
                                ],
                            }
                        ],
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
        global_check = report["checks"][0]
        item_check = report["items"][0]["checks"][0]
        assert set(migration._NULLABLE_FIELDS).issubset(global_check)
        assert set(migration._NULLABLE_FIELDS).issubset(item_check)
        assert global_check["remediation"] == "Fix it"
        assert item_check["details"] == {"attempt": 1}

        migration.downgrade()

        restored = json.loads(
            connection.execute(
                sa.text("SELECT precheck_report_json FROM bucket_migrations WHERE id = 1")
            ).scalar_one()
        )
        assert restored["checks"][0] == {"code": "global", "remediation": "Fix it"}
        assert restored["items"][0]["checks"][0] == {
            "code": "item",
            "details": {"attempt": 1},
        }
