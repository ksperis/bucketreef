# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pathlib import Path
from io import StringIO

from alembic import command
from alembic.config import Config
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
