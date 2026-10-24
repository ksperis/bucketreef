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
        / "0183_remove_bucket_migration_delete_source.py"
    )
    spec = util.spec_from_file_location(
        "migration_0183_remove_bucket_migration_delete_source",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def test_migration_removes_delete_source_contract(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    migrations = sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("delete_source", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("precheck_report_json", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            migrations.insert(),
            {
                "id": 1,
                "delete_source": True,
                "precheck_report_json": json.dumps(
                    {
                        "delete_source_safe": False,
                        "rollback_safe": True,
                        "items": [
                            {
                                "item_id": 10,
                                "delete_source_safe": False,
                                "rollback_safe": False,
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

        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_migrations")}
        assert "delete_source" not in columns
        report = json.loads(
            connection.execute(
                sa.text("SELECT precheck_report_json FROM bucket_migrations WHERE id = 1")
            ).scalar_one()
        )
        assert "delete_source_safe" not in report
        assert "delete_source_safe" not in report["items"][0]
        assert report["rollback_safe"] is True
        assert report["items"][0]["rollback_safe"] is False

        migration.downgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("bucket_migrations")}
        assert "delete_source" in columns
        restored = connection.execute(
            sa.text(
                "SELECT delete_source, precheck_report_json FROM bucket_migrations WHERE id = 1"
            )
        ).mappings().one()
        assert bool(restored["delete_source"]) is False
        restored_report = json.loads(restored["precheck_report_json"])
        assert restored_report["delete_source_safe"] is True
        assert restored_report["items"][0]["delete_source_safe"] is True
