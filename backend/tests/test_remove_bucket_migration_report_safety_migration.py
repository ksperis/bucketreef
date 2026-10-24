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
        / "0184_remove_bucket_migration_report_safety.py"
    )
    spec = util.spec_from_file_location(
        "migration_0184_remove_bucket_migration_report_safety",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_and_reconstructs_report_safety(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("use_same_endpoint_copy", sa.Boolean(), nullable=False),
        sa.Column("precheck_report_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            {
                "id": 1,
                "use_same_endpoint_copy": True,
                "precheck_report_json": json.dumps(
                    {
                        "rollback_safe": False,
                        "same_endpoint_copy_safe": False,
                        "items": [
                            {
                                "item_id": 10,
                                "rollback_safe": True,
                                "same_endpoint_copy_safe": True,
                                "checks": [
                                    {"code": "same_endpoint_copy_validated"},
                                ],
                            },
                            {
                                "item_id": 11,
                                "rollback_safe": False,
                                "same_endpoint_copy_safe": False,
                                "checks": [
                                    {"code": "same_endpoint_copy_unvalidated"},
                                    {"code": "rollback_not_safe"},
                                ],
                            },
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
        assert all(field not in report for field in migration._SAFETY_FIELDS)
        assert all(
            field not in item
            for item in report["items"]
            for field in migration._SAFETY_FIELDS
        )

        migration.downgrade()

        restored = json.loads(
            connection.execute(
                sa.text("SELECT precheck_report_json FROM bucket_migrations WHERE id = 1")
            ).scalar_one()
        )
        assert restored["rollback_safe"] is False
        assert restored["same_endpoint_copy_safe"] is False
        assert restored["items"][0]["rollback_safe"] is True
        assert restored["items"][0]["same_endpoint_copy_safe"] is True
        assert restored["items"][1]["rollback_safe"] is False
        assert restored["items"][1]["same_endpoint_copy_safe"] is False
