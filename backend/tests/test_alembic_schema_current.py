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

    assert script.get_heads() == ["0143_external_ceph_admin_credentials"]


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
            ).all() == ["0143_external_ceph_admin_credentials"]
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
