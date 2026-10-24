# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from datetime import datetime
from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


REMOVED_COLUMNS = {
    "last_ratio_pct",
    "last_checked_at",
    "last_notified_level",
    "last_notified_at",
}


def _load_migration():
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0193_remove_unused_quota_alert_state.py"
    )
    spec = util.spec_from_file_location(
        "migration_0193_remove_unused_quota_alert_state",
        migration_path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        column["name"]
        for column in sa.inspect(connection).get_columns("quota_alert_states")
    }


def test_migration_removes_and_restores_unused_quota_alert_state(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    states = sa.Table(
        "quota_alert_states",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("last_level", sa.String(), nullable=False),
        sa.Column("last_ratio_pct", sa.Numeric(8, 3), nullable=True),
        sa.Column("last_checked_at", sa.DateTime(), nullable=False),
        sa.Column("last_notified_level", sa.String(), nullable=True),
        sa.Column("last_notified_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    metadata.create_all(engine)

    updated_at = datetime(2026, 10, 24, 17, 20)
    with engine.begin() as connection:
        connection.execute(
            states.insert().values(
                id=1,
                last_level="threshold",
                last_ratio_pct=91.5,
                last_checked_at=updated_at,
                last_notified_level="threshold",
                last_notified_at=updated_at,
                updated_at=updated_at,
            )
        )

        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert REMOVED_COLUMNS.isdisjoint(_column_names(connection))
        row = connection.execute(
            sa.text("SELECT last_level, updated_at FROM quota_alert_states WHERE id = 1")
        ).one()
        assert row[0] == "threshold"

        migration.downgrade()

        assert REMOVED_COLUMNS <= _column_names(connection)
        restored = connection.execute(
            sa.text(
                "SELECT last_ratio_pct, last_checked_at, last_notified_level, "
                "last_notified_at FROM quota_alert_states WHERE id = 1"
            )
        ).one()
        assert restored[0] is None
        assert restored[1] is not None
        assert restored[2:] == (None, None)
