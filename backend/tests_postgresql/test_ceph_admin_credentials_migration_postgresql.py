# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import os
import uuid

from alembic import command
import pytest
import sqlalchemy as sa

from app.core.security import (
    clear_credential_keys_override,
    decrypt_secret,
    encrypt_secret,
    set_credential_keys_override,
)
from app.services import database_initialization


def _postgresql_url() -> str:
    url = os.getenv("POSTGRES_TEST_DATABASE_URL", "").strip()
    if not url:
        pytest.skip("POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests")
    if not url.startswith(("postgresql://", "postgresql+psycopg2://")):
        pytest.fail("POSTGRES_TEST_DATABASE_URL must target PostgreSQL")
    return url


def test_postgresql_upgrade_from_0_2_13_preserves_ceph_admin_credentials() -> None:
    database_url = _postgresql_url()
    schema_name = f"bucketreef_ceph_admin_migration_{uuid.uuid4().hex}"
    admin_engine = sa.create_engine(database_url, pool_pre_ping=True)
    scoped_engine = None
    set_credential_keys_override(["ceph-admin-postgresql-migration-test-key"])
    try:
        with admin_engine.begin() as connection:
            connection.execute(sa.text(f'CREATE SCHEMA "{schema_name}"'))

        scoped_engine = sa.create_engine(
            database_url,
            connect_args={"options": f"-csearch_path={schema_name}"},
            pool_pre_ping=True,
        )
        config = database_initialization._alembic_config()
        config.attributes["configure_logger"] = False

        with scoped_engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "0137_browser_path_favorites")

        encrypted_secret = encrypt_secret("legacy-ceph-admin-secret")
        with scoped_engine.begin() as connection:
            connection.execute(
                sa.text(
                    "INSERT INTO storage_endpoints "
                    "(name, endpoint_url, provider, ceph_admin_access_key, ceph_admin_secret_key, created_at, updated_at) "
                    "VALUES (:name, :endpoint_url, 'ceph', :access_key, :secret_key, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "name": "Legacy Ceph endpoint",
                    "endpoint_url": "https://rgw.example.test",
                    "access_key": "LEGACY-CEPH-AK",
                    "secret_key": encrypted_secret,
                },
            )

        with scoped_engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

        with scoped_engine.connect() as connection:
            identity = connection.execute(
                sa.text(
                    "SELECT mode, access_key, secret_key, status, rgw_uid, provenance "
                    "FROM endpoint_service_identities WHERE kind = 'ceph_admin'"
                )
            ).mappings().one()
            assert identity["mode"] == "external"
            assert identity["access_key"] == "LEGACY-CEPH-AK"
            assert identity["secret_key"] == encrypted_secret
            assert decrypt_secret(identity["secret_key"]) == "legacy-ceph-admin-secret"
            assert identity["status"] == "missing"
            assert identity["rgw_uid"] is None
            assert identity["provenance"] is None
            assert connection.scalar(sa.text("SELECT version_num FROM alembic_version")) == "0143_external_ceph_admin_credentials"
    finally:
        clear_credential_keys_override()
        if scoped_engine is not None:
            scoped_engine.dispose()
        with admin_engine.begin() as connection:
            connection.execute(sa.text(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE'))
        admin_engine.dispose()
