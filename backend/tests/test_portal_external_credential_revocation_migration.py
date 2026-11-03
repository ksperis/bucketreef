# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic/versions/0226_portal_external_credential_revocation.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location(
        "portal_external_credential_revocation_migration",
        MIGRATION_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _credential_table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "portal_external_access_credentials",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.CheckConstraint(
            "status IN ('Active', 'Inactive')",
            name="ck_portal_external_access_credentials_status",
        ),
    )


def test_upgrade_allows_durable_revocation_pending_status():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    credentials = _credential_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            credentials.insert(),
            [
                {"id": 1, "status": "Active"},
                {"id": 2, "status": "Inactive"},
            ],
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        connection.execute(credentials.insert().values(id=3, status="RevocationPending"))
        assert connection.execute(
            sa.select(credentials.c.id, credentials.c.status).order_by(credentials.c.id)
        ).all() == [
            (1, "Active"),
            (2, "Inactive"),
            (3, "RevocationPending"),
        ]


def test_downgrade_rejects_pending_external_revocations():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    credentials = _credential_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()
        connection.execute(credentials.insert().values(id=1, status="RevocationPending"))

        with pytest.raises(RuntimeError, match="Complete pending Portal external-credential revocations"):
            migration.downgrade()
