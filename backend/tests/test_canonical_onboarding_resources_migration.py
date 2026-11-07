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
        / "0261_canonical_onboarding_resources.py"
    )
    spec = util.spec_from_file_location("migration_0261_canonical_onboarding_resources", path)
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


def test_migration_prunes_checkpoint_metadata_after_canonical_ids_exist():
    engine = sa.create_engine("sqlite:///:memory:")
    journeys = _schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            journeys.insert().values(
                id="completed-checkpoints",
                draft={"version": 2, "endpoint_id": 7, "endpoint_url": ""},
                resources={
                    "endpoint_created": True,
                    "endpoint_name": "New endpoint",
                    "rgw_account_id": "RGW70000000000000042",
                    "account_name": "bucketreef-sample",
                    "account_id": 12,
                    "connection_id": 18,
                },
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        assert connection.scalar(sa.select(journeys.c.resources)) == {
            "endpoint_created": True,
            "account_id": 12,
            "connection_id": 18,
        }


def test_migration_preserves_retry_metadata_before_resources_are_created():
    engine = sa.create_engine("sqlite:///:memory:")
    journeys = _schema(engine)
    migration = _load_migration()
    expected = {
        "endpoint_name": "New endpoint",
        "rgw_account_id": "RGW70000000000000042",
        "account_name": "bucketreef-sample",
    }

    with engine.begin() as connection:
        connection.execute(
            journeys.insert().values(
                id="pending",
                draft={"version": 2, "endpoint_id": None, "endpoint_url": "https://rgw.test"},
                resources=expected,
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))

        migration.upgrade()

        assert connection.scalar(sa.select(journeys.c.resources)) == expected


def test_migration_rejects_unknown_checkpoint_keys():
    engine = sa.create_engine("sqlite:///:memory:")
    journeys = _schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            journeys.insert().values(
                id="unknown",
                draft={"version": 2, "endpoint_id": None, "endpoint_url": "https://rgw.test"},
                resources={"obsolete_checkpoint": 1},
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(ValueError, match="unknown resource keys"):
            migration.upgrade()


def test_migration_rejects_created_endpoint_without_canonical_draft_id():
    engine = sa.create_engine("sqlite:///:memory:")
    journeys = _schema(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            journeys.insert().values(
                id="invalid-created-endpoint",
                draft={"version": 2, "endpoint_id": None, "endpoint_url": "https://rgw.test"},
                resources={"endpoint_created": True},
            )
        )
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(ValueError, match="draft.endpoint_id must be a positive integer"):
            migration.upgrade()
