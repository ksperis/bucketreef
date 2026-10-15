# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
import pytest
import sqlalchemy as sa

from app.core.config import get_settings
from app.db import Base


def _alembic_config() -> Config:
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["configure_logger"] = False
    return config


def test_alembic_exposes_single_merge_head():
    script = ScriptDirectory.from_config(_alembic_config())

    assert script.get_heads() == ["0155_canonical_audit_context"]


def test_alembic_head_matches_sqlalchemy_metadata(tmp_path, monkeypatch):
    database_path = tmp_path / "schema-current.sqlite"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database_path}")
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    try:
        command.upgrade(config, "head")
        engine = sa.create_engine(f"sqlite:///{database_path}")
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={"compare_type": True},
            )
            assert compare_metadata(context, Base.metadata) == []
        engine.dispose()
    finally:
        get_settings.cache_clear()


@pytest.mark.parametrize(
    "starting_revision",
    [
        "0134_portal_collaborator_delegation",
        "0135_bucket_migration_workflow",
        "0135_browser_presets",
    ],
)
def test_alembic_merge_head_upgrades_from_each_branch(
    tmp_path,
    monkeypatch,
    starting_revision: str,
):
    database_path = tmp_path / f"upgrade-{starting_revision}.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, starting_revision)
        with engine.connect() as connection:
            table_names = set(sa.inspect(connection).get_table_names())
            migration_columns = {
                column["name"]
                for column in sa.inspect(connection).get_columns("bucket_migrations")
            }
            assert ("browser_presets" in table_names) is (
                starting_revision == "0135_browser_presets"
            )
            assert ("workflow_version" in migration_columns) is (
                starting_revision == "0135_bucket_migration_workflow"
            )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            assert connection.scalars(
                sa.text("SELECT version_num FROM alembic_version")
            ).all() == ["0155_canonical_audit_context"]
            table_names = set(sa.inspect(connection).get_table_names())
            assert "browser_favorites" in table_names
            assert "browser_presets" not in table_names
            assert "workflow_version" in {
                column["name"]
                for column in sa.inspect(connection).get_columns("bucket_migrations")
            }
            context = MigrationContext.configure(
                connection,
                opts={"compare_type": True},
            )
            assert compare_metadata(context, Base.metadata) == []
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_canonical_audit_context_migration_backfills_and_drops_legacy_columns(
    tmp_path,
    monkeypatch,
):
    database_path = tmp_path / "audit-context-cutover.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.delenv("BUCKETREEF_DB_BACKUP_VERIFIED", raising=False)
    get_settings.cache_clear()

    config = _alembic_config()
    engine = sa.create_engine(database_url)
    try:
        command.upgrade(config, "0154_bucket_usage_stats_collection_policy")
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO audit_logs "
                    "(created_at, user_email, user_role, scope, action, account_id, account_name, status) "
                    "VALUES (CURRENT_TIMESTAMP, 'admin@example.test', 'ui_admin', 'admin', "
                    "'legacy-account-event', 42, 'Research', 'success')"
                )
            )
            connection.execute(
                sa.text(
                    "INSERT INTO audit_logs "
                    "(created_at, user_email, user_role, scope, action, account_id, account_name, "
                    "context_kind, context_id, context_name, status) "
                    "VALUES (CURRENT_TIMESTAMP, 'portal@example.test', 'ui_user', 'portal', "
                    "'legacy-portal-event', 43, 'Portal Research', 'account', '43', "
                    "'Portal Research', 'success')"
                )
            )

        command.upgrade(config, "head")

        with engine.connect() as connection:
            columns = {column["name"] for column in sa.inspect(connection).get_columns("audit_logs")}
            assert "account_id" not in columns
            assert "account_name" not in columns
            row = connection.execute(
                sa.text(
                    "SELECT context_kind, context_id, context_name "
                    "FROM audit_logs WHERE action = 'legacy-account-event'"
                )
            ).one()
            assert tuple(row) == ("account", "42", "Research")
            portal_row = connection.execute(
                sa.text(
                    "SELECT context_kind, context_id, context_name "
                    "FROM audit_logs WHERE action = 'legacy-portal-event'"
                )
            ).one()
            assert tuple(portal_row) == ("portal_account", "43", "Portal Research")
    finally:
        engine.dispose()
        get_settings.cache_clear()
