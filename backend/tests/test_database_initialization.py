# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator
import json

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
import pytest
import sqlalchemy as sa
from sqlalchemy.engine import Engine

from app.core.config import get_settings
from app.db import AppSetting, Base
from app.services import database_initialization
from app.utils.time import utcnow


@pytest.fixture
def sqlite_database(tmp_path, monkeypatch) -> Iterator[Engine]:
    database_path = tmp_path / "database-initialization.sqlite"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    monkeypatch.setattr(database_initialization, "settings", get_settings())
    engine = sa.create_engine(database_url)
    try:
        yield engine
    finally:
        engine.dispose()
        get_settings.cache_clear()


def _alembic_head() -> str:
    head = ScriptDirectory.from_config(database_initialization._alembic_config()).get_current_head()
    assert head is not None
    return head


def _database_revision(connection) -> str | None:
    return connection.scalar(sa.text("SELECT version_num FROM alembic_version"))


def test_empty_database_uses_metadata_bootstrap_then_regular_upgrade(
    sqlite_database: Engine,
    monkeypatch,
) -> None:
    original_upgrade = database_initialization.command.upgrade
    upgrade_targets: list[str] = []

    def track_upgrade(config, target: str) -> None:
        upgrade_targets.append(target)
        original_upgrade(config, target)

    monkeypatch.setattr(database_initialization.command, "upgrade", track_upgrade)

    database_initialization._initialize_or_upgrade_schema(sqlite_database)

    assert upgrade_targets == []
    with sqlite_database.connect() as connection:
        table_names = set(sa.inspect(connection).get_table_names())
        assert set(Base.metadata.tables).issubset(table_names)
        assert _database_revision(connection) == _alembic_head()
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert compare_metadata(context, Base.metadata) == []

    database_initialization._initialize_or_upgrade_schema(sqlite_database)

    assert upgrade_targets == ["head"]
    with sqlite_database.connect() as connection:
        assert _database_revision(connection) == _alembic_head()


def test_non_empty_unversioned_database_is_rejected(sqlite_database: Engine) -> None:
    with sqlite_database.begin() as connection:
        connection.execute(sa.text("CREATE TABLE unmanaged_data (id INTEGER PRIMARY KEY)"))

    with pytest.raises(RuntimeError, match="not empty and has no alembic_version table"):
        database_initialization._initialize_or_upgrade_schema(sqlite_database)

    with sqlite_database.connect() as connection:
        assert "alembic_version" not in sa.inspect(connection).get_table_names()


def test_versioned_database_upgrades_from_initial_revision(sqlite_database: Engine) -> None:
    database_initialization.command.upgrade(
        database_initialization._alembic_config(),
        "0001_initial_schema",
    )
    with sqlite_database.connect() as connection:
        assert _database_revision(connection) == "0001_initial_schema"

    database_initialization._initialize_or_upgrade_schema(sqlite_database)

    with sqlite_database.connect() as connection:
        assert _database_revision(connection) == _alembic_head()
        context = MigrationContext.configure(connection, opts={"compare_type": True})
        assert compare_metadata(context, Base.metadata) == []


def test_versioned_database_upgrades_from_0118_and_preserves_data(sqlite_database: Engine) -> None:
    database_initialization.command.upgrade(
        database_initialization._alembic_config(),
        "0118_canonical_storage_endpoint_urls",
    )
    now = utcnow()
    with sqlite_database.begin() as connection:
        connection.execute(
            AppSetting.__table__.insert().values(
                key="bootstrap-test",
                payload_json='{"preserved":true}',
                created_at=now,
                updated_at=now,
            )
        )

    database_initialization._initialize_or_upgrade_schema(sqlite_database)

    with sqlite_database.connect() as connection:
        assert _database_revision(connection) == _alembic_head()
        assert "first_admin_bootstrap" in sa.inspect(connection).get_table_names()
        payload = json.loads(connection.scalar(
            sa.select(AppSetting.payload_json).where(AppSetting.key == "bootstrap-test")
        ))
        assert payload["preserved"] is True
        assert payload["general"]["require_passkey_for_admins"] is True


def test_versioned_sqlite_upgrade_preserves_referencing_rows_with_foreign_keys_enabled(
    sqlite_database: Engine,
) -> None:
    database_initialization.command.upgrade(
        database_initialization._alembic_config(),
        "0125_guided_onboarding",
    )
    with sqlite_database.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        connection.exec_driver_sql(
            """
            INSERT INTO storage_endpoints (
                id,
                name,
                endpoint_url,
                provider,
                force_path_style,
                verify_tls,
                is_default,
                is_editable,
                created_at,
                updated_at
            )
            VALUES (
                1,
                'migration-endpoint',
                'https://s3.example.test',
                'ceph',
                0,
                1,
                1,
                1,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO s3_users (
                id,
                name,
                rgw_user_uid,
                rgw_access_key,
                rgw_secret_key,
                created_at,
                updated_at,
                storage_endpoint_id
            )
            VALUES (
                1,
                'migration-user',
                'migration-user',
                'access-key',
                'encrypted-placeholder',
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP,
                1
            )
            """
        )
        connection.exec_driver_sql(
            """
            INSERT INTO s3_accounts (
                id,
                name,
                rgw_account_id,
                rgw_user_uid,
                created_at,
                updated_at,
                storage_endpoint_id
            )
            VALUES (
                1,
                'migration-account',
                ' RGW00000000000000001 ',
                ' migration-account-root ',
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP,
                1
            )
            """
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE migration_s3_user_refs (
                id INTEGER PRIMARY KEY,
                s3_user_id INTEGER NOT NULL REFERENCES s3_users(id)
            )
            """
        )
        connection.exec_driver_sql(
            "INSERT INTO migration_s3_user_refs (id, s3_user_id) VALUES (1, 1)"
        )
        connection.exec_driver_sql(
            """
            CREATE TABLE migration_s3_account_refs (
                id INTEGER PRIMARY KEY,
                s3_account_id INTEGER NOT NULL REFERENCES s3_accounts(id)
            )
            """
        )
        connection.exec_driver_sql(
            "INSERT INTO migration_s3_account_refs (id, s3_account_id) VALUES (1, 1)"
        )

    database_initialization._initialize_or_upgrade_schema(sqlite_database)

    with sqlite_database.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        assert connection.scalar(
            sa.text("SELECT s3_user_id FROM migration_s3_user_refs WHERE id = 1")
        ) == 1
        assert connection.scalar(
            sa.text("SELECT s3_account_id FROM migration_s3_account_refs WHERE id = 1")
        ) == 1
        account_identity = connection.execute(
            sa.text(
                "SELECT rgw_account_id, rgw_user_uid FROM s3_accounts WHERE id = 1"
            )
        ).one()
        assert account_identity == ("RGW00000000000000001", "migration-account-root")
        assert _database_revision(connection) == _alembic_head()
