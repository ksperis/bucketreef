# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import importlib.util
import os
from pathlib import Path
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations



@pytest.mark.parametrize("dialect", ["sqlite", "postgresql"])
def test_pending_retirements_migrate_without_decrypting_or_losing_pair(monkeypatch, dialect):
    url = "sqlite:///:memory:" if dialect == "sqlite" else os.getenv("BUCKETREEF_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("BUCKETREEF_TEST_POSTGRES_URL is not set for an isolated PostgreSQL database")
    engine = sa.create_engine(url)
    path = Path(__file__).resolve().parents[1] / "alembic/versions/0141_durable_key_rotation.py"
    spec = importlib.util.spec_from_file_location("durable_key_rotation_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    schema = "rotation_test_" + uuid4().hex
    try:
        with engine.begin() as connection:
            if dialect == "postgresql":
                connection.exec_driver_sql(f"CREATE SCHEMA {schema}")
                connection.exec_driver_sql(f"SET search_path TO {schema}")
            metadata = sa.MetaData()
            endpoints = sa.Table("storage_endpoints", metadata,
                sa.Column("id", sa.Integer, primary_key=True), sa.Column("endpoint_url", sa.String),
                sa.Column("features_config", sa.String))
            identities = sa.Table("endpoint_service_identities", metadata,
                sa.Column("id", sa.Integer, primary_key=True), sa.Column("endpoint_id", sa.Integer),
                sa.Column("kind", sa.String), sa.Column("rgw_uid", sa.String), sa.Column("access_key", sa.String),
                sa.Column("secret_key", sa.String), sa.Column("previous_access_key", sa.String), sa.Column("last_error", sa.String))
            metadata.create_all(connection)
            connection.execute(endpoints.insert().values(id=1, endpoint_url="https://s3.example.test", features_config="features:\n  admin:\n    endpoint: https://admin.example.test\n"))
            connection.execute(identities.insert().values(id=2, endpoint_id=1, kind="runtime", rgw_uid="owned-runtime",
                access_key="NEW", secret_key="ciphertext-preserved-verbatim", previous_access_key="OLD"))
            monkeypatch.setattr(module, "op", Operations(MigrationContext.configure(connection)))
            module.upgrade()
            assert "previous_access_key" not in {col["name"] for col in sa.inspect(connection).get_columns("endpoint_service_identities")}
            pending = connection.execute(sa.text("SELECT * FROM key_rotation_intents")).mappings().one()
            assert pending["phase"] == "activated" and pending["key_type"] == "endpoint_runtime"
            assert pending["target_id"] == 2 and pending["old_access_key"] == "OLD" and pending["new_access_key"] == "NEW"
            assert pending["new_secret_key"] == "ciphertext-preserved-verbatim"
            assert pending["rgw_endpoint"] == "https://admin.example.test"
            with pytest.raises(RuntimeError, match="Finish pending"):
                module.downgrade()
            # The journal is unique per target, and persisted times have UTC semantics.
            journal = sa.Table("key_rotation_intents", sa.MetaData(), autoload_with=connection)
            assert sa.inspect(connection).get_unique_constraints("key_rotation_intents")[0]["column_names"] == ["endpoint_id", "key_type", "target_id"]
            if dialect == "postgresql":
                assert str(journal.c.created_at.type) == "TIMESTAMP"
                assert journal.c.created_at.type.timezone
            connection.execute(journal.delete())
            module.downgrade()
            assert "previous_access_key" in {col["name"] for col in sa.inspect(connection).get_columns("endpoint_service_identities")}
    finally:
        if dialect == "postgresql":
            with engine.begin() as connection:
                connection.exec_driver_sql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")
        engine.dispose()
