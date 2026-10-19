# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pathlib import Path
from io import StringIO

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
import sqlalchemy as sa

from app.core.config import get_settings
from app.db import StorageEndpoint
from sqlalchemy.orm import Session


def test_postgresql_tenant_migration_emits_composite_identity_constraints(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://test:test@localhost/tenant-migration")
    get_settings.cache_clear()
    output = StringIO()
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"), output_buffer=output)
    config.attributes["configure_logger"] = False
    try:
        command.upgrade(config, "0151_project_usage_feature_overrides:0152_rgw_principal_tenants", sql=True)
        sql = output.getvalue()
        assert "ADD COLUMN rgw_tenant" in sql
        assert "DEFAULT '' NOT NULL" in sql
        assert "UNIQUE (storage_endpoint_id, rgw_tenant, rgw_user_uid)" in sql
        assert "coalesce(rgw_tenant, '')" not in sql
    finally:
        get_settings.cache_clear()


def test_tenant_migration_backfills_default_scope_and_enforces_uniqueness(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'tenants.sqlite'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["configure_logger"] = False
    engine = sa.create_engine(url)
    try:
        command.upgrade(config, "0151_project_usage_feature_overrides")
        with Session(engine) as session:
            session.add(StorageEndpoint(id=1, name="test", endpoint_url="https://rgw.invalid", provider="ceph"))
            session.commit()
        with engine.begin() as conn:
            conn.execute(sa.text("INSERT INTO s3_users (name, rgw_user_uid, rgw_access_key, rgw_secret_key, storage_endpoint_id, created_at, updated_at) VALUES ('Legacy', 'analyst', 'KEY', 'SECRET', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
            conn.execute(sa.text("INSERT INTO s3_accounts (name, rgw_account_id, rgw_user_uid, storage_endpoint_id, created_at, updated_at) VALUES ('Legacy account', 'RGW12345678901234567', 'account-root', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        command.upgrade(config, "head")
        with engine.begin() as conn:
            assert conn.execute(sa.text("SELECT rgw_tenant FROM s3_users")).scalar() == ""
            assert conn.execute(sa.text("SELECT rgw_tenant FROM s3_accounts")).scalar() == ""
            user_tenant = next(column for column in sa.inspect(conn).get_columns("s3_users") if column["name"] == "rgw_tenant")
            account_tenant = next(column for column in sa.inspect(conn).get_columns("s3_accounts") if column["name"] == "rgw_tenant")
            assert not user_tenant["nullable"]
            assert not account_tenant["nullable"]
            with pytest.raises(sa.exc.IntegrityError):
                with conn.begin_nested():
                    conn.execute(sa.text("INSERT INTO s3_users (name, rgw_user_uid, rgw_access_key, rgw_secret_key, storage_endpoint_id, created_at, updated_at) VALUES ('Duplicate', 'analyst', 'KEY2', 'SECRET', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
            conn.execute(sa.text("INSERT INTO s3_users (name, rgw_user_uid, rgw_tenant, rgw_access_key, rgw_secret_key, storage_endpoint_id, created_at, updated_at) VALUES ('Tenant', 'analyst', 'customer01', 'KEY3', 'SECRET', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        with pytest.raises(RuntimeError, match="non-unique"):
            command.downgrade(config, "0151_project_usage_feature_overrides")
        with engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM s3_users WHERE rgw_tenant = 'customer01'"))
        command.downgrade(config, "0151_project_usage_feature_overrides")
        with engine.connect() as conn:
            assert "rgw_tenant" not in {column["name"] for column in sa.inspect(conn).get_columns("s3_users")}
            assert conn.execute(sa.text("SELECT COUNT(*) FROM s3_users")).scalar() == 1
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_compat_migration_repairs_databases_that_already_ran_original_0152(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'tenant-compat.sqlite'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["configure_logger"] = False
    engine = sa.create_engine(url)
    try:
        command.upgrade(config, "0151_project_usage_feature_overrides")
        with Session(engine) as session:
            session.add(StorageEndpoint(id=1, name="test", endpoint_url="https://rgw.invalid", provider="ceph"))
            session.commit()
        with engine.begin() as conn:
            conn.execute(sa.text("INSERT INTO s3_users (name, rgw_user_uid, rgw_access_key, rgw_secret_key, storage_endpoint_id, created_at, updated_at) VALUES ('Legacy', 'analyst', 'KEY', 'SECRET', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
            conn.execute(sa.text("INSERT INTO s3_accounts (name, rgw_account_id, rgw_user_uid, storage_endpoint_id, created_at, updated_at) VALUES ('Legacy account', 'RGW12345678901234567', 'account-root', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
        command.upgrade(config, "0152_rgw_principal_tenants")

        # Recreate the schema produced by the original development-only 0152.
        with engine.begin() as conn:
            operations = Operations(MigrationContext.configure(conn))
            with operations.batch_alter_table("s3_accounts") as batch:
                batch.alter_column("rgw_tenant", existing_type=sa.String(), nullable=True, server_default=None)
            with operations.batch_alter_table("s3_users") as batch:
                batch.alter_column("rgw_tenant", existing_type=sa.String(), nullable=True, server_default=None)
            conn.execute(sa.text(
                "CREATE UNIQUE INDEX uq_s3_users_endpoint_effective_tenant_uid "
                "ON s3_users (storage_endpoint_id, coalesce(rgw_tenant, ''), rgw_user_uid)"
            ))
            conn.execute(sa.text("UPDATE s3_accounts SET rgw_tenant = NULL"))
            conn.execute(sa.text("UPDATE s3_users SET rgw_tenant = NULL"))

        command.upgrade(config, "head")
        with engine.connect() as conn:
            inspector = sa.inspect(conn)
            account_tenant = next(c for c in inspector.get_columns("s3_accounts") if c["name"] == "rgw_tenant")
            user_tenant = next(c for c in inspector.get_columns("s3_users") if c["name"] == "rgw_tenant")
            assert not account_tenant["nullable"]
            assert not user_tenant["nullable"]
            assert account_tenant["default"] is not None
            assert user_tenant["default"] is not None
            assert conn.execute(sa.text("SELECT rgw_tenant FROM s3_accounts")).scalar() == ""
            assert conn.execute(sa.text("SELECT rgw_tenant FROM s3_users")).scalar() == ""
            assert conn.execute(sa.text(
                "SELECT COUNT(*) FROM sqlite_master "
                "WHERE type = 'index' AND name = 'uq_s3_users_endpoint_effective_tenant_uid'"
            )).scalar() == 0
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_account_name_scope_migration_replaces_global_uniqueness(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'account-name-scope.sqlite'}"
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.attributes["configure_logger"] = False
    engine = sa.create_engine(url)
    try:
        command.upgrade(config, "0164_billing_statement_automation")
        with Session(engine) as session:
            session.add_all(
                [
                    StorageEndpoint(
                        id=1,
                        name="scope-a",
                        endpoint_url="https://scope-a.invalid",
                        provider="ceph",
                    ),
                    StorageEndpoint(
                        id=2,
                        name="scope-b",
                        endpoint_url="https://scope-b.invalid",
                        provider="ceph",
                    ),
                ]
            )
            session.commit()
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO s3_accounts "
                    "(name, rgw_account_id, rgw_tenant, rgw_user_uid, storage_endpoint_id, created_at, updated_at) "
                    "VALUES ('Research', 'RGW-SCOPE-1', 'team_a', 'root-a', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )

        command.upgrade(config, "0165_scope_s3_account_names")

        with engine.begin() as conn:
            constraints = sa.inspect(conn).get_unique_constraints("s3_accounts")
            assert any(
                constraint["name"] == "uq_s3_accounts_endpoint_tenant_name"
                and constraint["column_names"] == ["storage_endpoint_id", "rgw_tenant", "name"]
                for constraint in constraints
            )
            assert not any(
                constraint["column_names"] == ["name"]
                for constraint in constraints
            )
            conn.execute(
                sa.text(
                    "INSERT INTO s3_accounts "
                    "(name, rgw_account_id, rgw_tenant, rgw_user_uid, storage_endpoint_id, created_at, updated_at) "
                    "VALUES ('Research', 'RGW-SCOPE-2', 'team_b', 'root-b', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            conn.execute(
                sa.text(
                    "INSERT INTO s3_accounts "
                    "(name, rgw_account_id, rgw_tenant, rgw_user_uid, storage_endpoint_id, created_at, updated_at) "
                    "VALUES ('Research', 'RGW-SCOPE-3', 'team_a', 'root-c', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                )
            )
            with pytest.raises(sa.exc.IntegrityError):
                with conn.begin_nested():
                    conn.execute(
                        sa.text(
                            "INSERT INTO s3_accounts "
                            "(name, rgw_account_id, rgw_tenant, rgw_user_uid, storage_endpoint_id, created_at, updated_at) "
                            "VALUES ('Research', 'RGW-SCOPE-4', 'team_a', 'root-d', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                        )
                    )

        with pytest.raises(RuntimeError, match="globally non-unique"):
            command.downgrade(config, "0164_billing_statement_automation")

        with engine.begin() as conn:
            conn.execute(sa.text("DELETE FROM s3_accounts WHERE rgw_account_id IN ('RGW-SCOPE-2', 'RGW-SCOPE-3')"))
        command.downgrade(config, "0164_billing_statement_automation")
        with engine.begin() as conn:
            with pytest.raises(sa.exc.IntegrityError):
                with conn.begin_nested():
                    conn.execute(
                        sa.text(
                            "INSERT INTO s3_accounts "
                            "(name, rgw_account_id, rgw_tenant, rgw_user_uid, storage_endpoint_id, created_at, updated_at) "
                            "VALUES ('Research', 'RGW-SCOPE-5', 'team_b', 'root-e', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                        )
                    )
    finally:
        engine.dispose()
        get_settings.cache_clear()
