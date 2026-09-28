# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from importlib import util
from pathlib import Path
import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


@pytest.fixture
def schema(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    sa.Table("users", metadata, sa.Column("id", sa.Integer(), primary_key=True))
    sa.Table(
        "bucket_migrations",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String()),
        sa.Column("mode", sa.String(), server_default="one_shot"),
        sa.Column("precheck_status", sa.String()),
        sa.Column("precheck_report_json", sa.Text()),
        sa.Column("precheck_checked_at", sa.DateTime()),
        sa.Column("delete_source", sa.Boolean()),
    )
    sa.Table(
        "bucket_migration_items",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("migration_id", sa.Integer()),
        sa.Column("read_only_applied", sa.Boolean(), server_default="0"),
        sa.Column("target_lock_applied", sa.Boolean(), server_default="0"),
        sa.Column("execution_plan_json", sa.Text()),
    )
    metadata.create_all(engine)
    spec = util.spec_from_file_location(
        "migration_workflow",
        Path(__file__).resolve().parents[1]
        / "alembic/versions/0135_bucket_migration_workflow.py",
    )
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with engine.begin() as connection:
        monkeypatch.setattr(
            migration, "op", Operations(MigrationContext.configure(connection))
        )
        yield connection, migration


def test_upgrade_invalidates_drafts_and_keeps_history_without_replay(schema):
    db, migration = schema
    db.execute(
        sa.text(
            "INSERT INTO bucket_migrations(id,status,precheck_status,precheck_report_json,delete_source) VALUES (1,'draft','passed',:draft,TRUE),(2,'completed','passed',:history,TRUE)"
        ),
        {"draft": '{"old":true}', "history": '{"history":true}'},
    )
    db.execute(
        sa.text(
            "INSERT INTO bucket_migration_items(id,migration_id,execution_plan_json) VALUES (1,1,'{}'),(2,2,'{}')"
        )
    )
    migration.upgrade()
    draft, history = (
        db.execute(sa.text("SELECT * FROM bucket_migrations ORDER BY id"))
        .mappings()
        .all()
    )
    assert draft["workflow_version"] == 2
    assert draft["preparation_status"] == "stale"
    assert (
        draft["precheck_status"] == "pending" and draft["precheck_report_json"] is None
    )
    assert not draft["delete_source"]
    assert history["workflow_version"] == 1 and history["status"] == "completed"
    assert history["precheck_report_json"] == '{"history":true}'
    assert (
        db.execute(
            sa.text("SELECT execution_plan_json FROM bucket_migration_items WHERE id=1")
        ).scalar()
        is None
    )
    migration.downgrade()
    assert "preparation_status" not in {
        c["name"] for c in sa.inspect(db).get_columns("bucket_migrations")
    }


@pytest.mark.parametrize(
    "status,source_lock,target_lock",
    [
        ("running", False, False),
        ("awaiting_cutover", False, True),
        ("failed", True, False),
        ("completed", False, True),
    ],
)
def test_upgrade_requires_quiescence_and_verified_restoration(
    schema, status, source_lock, target_lock
):
    db, migration = schema
    db.execute(
        sa.text("INSERT INTO bucket_migrations(id,status) VALUES (1,:status)"),
        {"status": status},
    )
    db.execute(
        sa.text(
            "INSERT INTO bucket_migration_items(id,migration_id,read_only_applied,target_lock_applied) VALUES (1,1,:source,:target)"
        ),
        {"source": source_lock, "target": target_lock},
    )
    with pytest.raises(RuntimeError, match="Finish or stop"):
        migration.upgrade()
    assert "workflow_version" not in {
        c["name"] for c in sa.inspect(db).get_columns("bucket_migrations")
    }
