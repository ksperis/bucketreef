# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/0199_normalize_s3_connection_custom_endpoints.py"
    )
    spec = util.spec_from_file_location("migration_0199", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _create_schema(engine):
    metadata = sa.MetaData()
    connections = sa.Table(
        "s3_connections",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("storage_endpoint_id", sa.Integer(), nullable=True),
        sa.Column("custom_endpoint_config", sa.Text(), nullable=True),
    )
    metadata.create_all(engine)
    return connections


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def test_upgrade_backfills_structured_endpoint_fields_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    connections = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert(),
            [
                {
                    "id": 1,
                    "storage_endpoint_id": None,
                    "custom_endpoint_config": json.dumps(
                        {
                            "endpoint_url": " https://s3.example.test/ ",
                            "region": " eu-west-3 ",
                            "force_path_style": True,
                            "verify_tls": True,
                            "provider": " other ",
                        }
                    ),
                },
                {
                    "id": 2,
                    "storage_endpoint_id": 7,
                    "custom_endpoint_config": "stale-managed-data",
                },
            ],
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        migration.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("s3_connections")}
        assert "custom_endpoint_config" not in columns
        assert {
            "custom_endpoint_url",
            "custom_region",
            "custom_force_path_style",
            "custom_verify_tls",
            "custom_provider",
        } <= columns
        rows = connection.execute(
            sa.text(
                """
                SELECT id, storage_endpoint_id, custom_endpoint_url, custom_region,
                       custom_force_path_style, custom_verify_tls, custom_provider
                FROM s3_connections ORDER BY id
                """
            )
        ).mappings().all()
        assert dict(rows[0]) == {
            "id": 1,
            "storage_endpoint_id": None,
            "custom_endpoint_url": "https://s3.example.test",
            "custom_region": "eu-west-3",
            "custom_force_path_style": 1,
            "custom_verify_tls": 1,
            "custom_provider": "other",
        }
        assert dict(rows[1]) == {
            "id": 2,
            "storage_endpoint_id": 7,
            "custom_endpoint_url": None,
            "custom_region": None,
            "custom_force_path_style": None,
            "custom_verify_tls": None,
            "custom_provider": None,
        }
        assert {
            constraint["name"]
            for constraint in sa.inspect(connection).get_check_constraints("s3_connections")
        } == {"ck_s3_connections_endpoint_source"}

        migration.downgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("s3_connections")}
        assert "custom_endpoint_config" in columns
        assert "custom_endpoint_url" not in columns
        downgraded = connection.execute(
            sa.text(
                "SELECT id, custom_endpoint_config FROM s3_connections ORDER BY id"
            )
        ).mappings().all()
        assert json.loads(downgraded[0]["custom_endpoint_config"]) == {
            "endpoint_url": "https://s3.example.test",
            "force_path_style": True,
            "provider": "other",
            "region": "eu-west-3",
            "verify_tls": True,
        }
        assert downgraded[1]["custom_endpoint_config"] is None


@pytest.mark.parametrize("raw", [None, "{", "[]", "{}"])
def test_upgrade_rejects_unusable_manual_endpoint(raw, monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    connections = _create_schema(engine)

    with engine.begin() as connection:
        connection.execute(
            connections.insert().values(
                id=1,
                storage_endpoint_id=None,
                custom_endpoint_config=raw,
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="S3 connection 1 has no usable custom endpoint"):
            migration.upgrade()
