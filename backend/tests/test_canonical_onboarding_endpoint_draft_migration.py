# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0259_canonical_onboarding_endpoint_draft.py"
    )
    spec = util.spec_from_file_location("migration_0259_onboarding_endpoint_draft", path)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _schema(engine) -> sa.Table:
    metadata = sa.MetaData()
    journeys = sa.Table(
        "onboarding_journeys",
        metadata,
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("resources", sa.JSON(), nullable=False),
    )
    metadata.create_all(engine)
    return journeys


def test_migration_materializes_endpoint_checkpoint_in_draft():
    engine = sa.create_engine("sqlite:///:memory:")
    journeys = _schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            journeys.insert(),
            [
                {
                    "id": "created",
                    "draft": {
                        "version": 2,
                        "endpoint_id": None,
                        "endpoint_url": "https://new.example.test",
                        "region": "us-east-1",
                        "manager": True,
                    },
                    "resources": {"endpoint_id": 7, "endpoint_name": "New endpoint"},
                },
                {
                    "id": "existing",
                    "draft": {
                        "version": 2,
                        "endpoint_id": 9,
                        "endpoint_url": "",
                        "region": "",
                        "manager": True,
                    },
                    "resources": {},
                },
            ],
        )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        rows = {
            row["id"]: row
            for row in connection.execute(sa.select(journeys)).mappings().all()
        }
        assert rows["created"]["draft"] == {
            "version": 2,
            "endpoint_id": 7,
            "endpoint_url": "",
            "region": "us-east-1",
            "manager": True,
        }
        assert rows["created"]["resources"] == {
            "endpoint_id": 7,
            "endpoint_name": "New endpoint",
        }
        assert rows["existing"]["draft"]["endpoint_id"] == 9

        migration.downgrade()
        assert connection.scalar(
            sa.select(journeys.c.draft).where(journeys.c.id == "created")
        )["endpoint_id"] == 7


@pytest.mark.parametrize("endpoint_id", [True, 0, -1, "7"])
def test_migration_rejects_invalid_endpoint_checkpoint(endpoint_id):
    engine = sa.create_engine("sqlite:///:memory:")
    journeys = _schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            journeys.insert().values(
                id="invalid",
                draft={
                    "version": 2,
                    "endpoint_id": None,
                    "endpoint_url": "https://new.example.test",
                },
                resources={"endpoint_id": endpoint_id},
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(ValueError, match="positive integer"):
            migration.upgrade()
