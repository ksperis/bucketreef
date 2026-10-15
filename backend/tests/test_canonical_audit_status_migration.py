# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


MIGRATION_PATH = Path(__file__).resolve().parents[1] / "alembic/versions/0157_canonical_audit_status.py"


def _load_migration():
    spec = importlib.util.spec_from_file_location("canonical_audit_status_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _audit_table(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "audit_logs",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(), nullable=False),
    )


def test_upgrade_canonicalizes_historical_audit_statuses_and_enforces_constraint():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    audit_logs = _audit_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(
            audit_logs.insert(),
            [
                {"id": 1, "status": "success"},
                {"id": 2, "status": "failure"},
                {"id": 3, "status": "failed"},
                {"id": 4, "status": " ERROR "},
                {"id": 5, "status": "partial"},
            ],
        )
        migration.op = Operations(MigrationContext.configure(connection))
        migration.upgrade()

        rows = connection.execute(sa.select(audit_logs.c.id, audit_logs.c.status).order_by(audit_logs.c.id)).all()
        assert rows == [
            (1, "success"),
            (2, "failure"),
            (3, "failure"),
            (4, "failure"),
            (5, "partial"),
        ]
        constraints = {item["name"] for item in sa.inspect(connection).get_check_constraints("audit_logs")}
        assert "ck_audit_logs_status" in constraints
        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(audit_logs.insert().values(id=6, status="failed"))


def test_upgrade_rejects_unknown_audit_statuses():
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    audit_logs = _audit_table(metadata)
    metadata.create_all(engine)
    migration = _load_migration()

    with engine.begin() as connection:
        connection.execute(audit_logs.insert().values(id=1, status="mystery"))
        migration.op = Operations(MigrationContext.configure(connection))

        with pytest.raises(RuntimeError, match="Unknown audit status"):
            migration.upgrade()
