# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import sqlalchemy as sa
import yaml
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0200_structure_storage_endpoint_features.py"
    )
    spec = util.spec_from_file_location(
        "migration_0200_structure_storage_endpoint_features",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _storage_endpoints(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "storage_endpoints",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("region", sa.String()),
        sa.Column("features_config", sa.Text()),
    )


def test_migration_materializes_structured_features_and_drops_yaml(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    endpoints = _storage_endpoints(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            endpoints.insert(),
            [
                {
                    "id": 1,
                    "provider": "ceph",
                    "region": None,
                    "features_config": (
                        "features:\n"
                        "  admin:\n"
                        "    enabled: true\n"
                        "    endpoint: https://admin.example.test/\n"
                        "  healthcheck:\n"
                        "    enabled: true\n"
                        "    mode: s3\n"
                        "    healthcheck_url: https://health.example.test/\n"
                    ),
                },
                {
                    "id": 2,
                    "provider": "aws",
                    "region": "eu-west-3",
                    "features_config": None,
                },
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("storage_endpoints")}
        assert "features" in columns
        assert "features_config" not in columns
        rows = connection.execute(
            sa.text("SELECT id, features FROM storage_endpoints ORDER BY id")
        ).all()
        ceph_features = sa.JSON().result_processor(connection.dialect, None)(rows[0].features)
        aws_features = sa.JSON().result_processor(connection.dialect, None)(rows[1].features)
        assert ceph_features["admin"] == {
            "enabled": True,
            "endpoint": "https://admin.example.test",
        }
        assert ceph_features["healthcheck"] == {
            "enabled": True,
            "mode": "s3",
            "url": "https://health.example.test",
        }
        assert aws_features["sts"] == {
            "enabled": True,
            "endpoint": "https://sts.eu-west-3.amazonaws.com",
        }
        assert aws_features["iam"] == {
            "enabled": True,
            "endpoint": "https://iam.amazonaws.com",
        }
        assert aws_features["static_website"]["enabled"] is True
        assert aws_features["sse"]["enabled"] is True

        migration.downgrade()

        columns = {column["name"] for column in sa.inspect(connection).get_columns("storage_endpoints")}
        assert "features" not in columns
        assert "features_config" in columns
        restored = connection.execute(
            sa.text("SELECT features_config FROM storage_endpoints WHERE id = 1")
        ).scalar_one()
        restored_features = yaml.safe_load(restored)["features"]
        assert restored_features["admin"]["endpoint"] == "https://admin.example.test"
        assert restored_features["healthcheck"]["healthcheck_url"] == "https://health.example.test"
