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
        / "0173_canonical_bucket_migration_severity.py"
    )
    spec = util.spec_from_file_location(
        "migration_0173_canonical_bucket_migration_severity",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_canonicalizes_diagnostic_severity_and_restores_level(monkeypatch):
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
                            {"code": "global", "severity": "error", "level": "warning"}
                        ],
                        "items": [
                            {
                                "item_id": 10,
                                "checks": [
                                    {"code": "legacy", "level": "warning"},
                                    {"code": "current", "severity": "info", "level": "error"},
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
        assert report["checks"][0]["severity"] == "error"
        assert report["items"][0]["checks"][0]["severity"] == "warning"
        assert report["items"][0]["checks"][1]["severity"] == "info"
        assert all("level" not in check for check in report["checks"])
        assert all("level" not in check for check in report["items"][0]["checks"])

        migration.downgrade()

        restored = json.loads(
            connection.execute(
                sa.text("SELECT precheck_report_json FROM bucket_migrations WHERE id = 1")
            ).scalar_one()
        )
        for check in [*restored["checks"], *restored["items"][0]["checks"]]:
            assert check["level"] == check["severity"]
