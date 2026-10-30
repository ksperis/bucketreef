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
        / "alembic"
        / "versions"
        / "0217_structure_portal_settings_override.py"
    )
    spec = util.spec_from_file_location(
        "migration_0217_structure_portal_settings_override",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _legacy_schema(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "s3_accounts",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("portal_settings_override", sa.Text(), nullable=True),
    )


def _column_type(connection) -> sa.types.TypeEngine:
    column = next(
        item
        for item in sa.inspect(connection).get_columns("s3_accounts")
        if item["name"] == "portal_settings_override"
    )
    return column["type"]


def test_migration_materializes_structured_portal_override_and_downgrades(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = _legacy_schema(metadata)
    metadata.create_all(engine)
    payload = {
        "browser_access_enabled": True,
        "bucket_defaults": {"enable_cors": False},
    }

    with engine.begin() as connection:
        connection.execute(
            accounts.insert(),
            [
                {
                    "id": 1,
                    "portal_settings_override": json.dumps(payload),
                },
                {"id": 2, "portal_settings_override": None},
            ],
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert isinstance(_column_type(connection), sa.JSON)
        structured = sa.Table(
            "s3_accounts",
            sa.MetaData(),
            autoload_with=connection,
        )
        rows = connection.execute(
            sa.select(structured).order_by(structured.c.id)
        ).mappings().all()
        assert rows[0]["portal_settings_override"] == payload
        assert rows[1]["portal_settings_override"] is None
        assert connection.execute(
            sa.text(
                "SELECT portal_settings_override IS NULL "
                "FROM s3_accounts WHERE id = 2"
            )
        ).scalar_one() == 1

        migration.downgrade()

        assert isinstance(_column_type(connection), sa.Text)
        restored = connection.execute(
            sa.text(
                "SELECT id, portal_settings_override "
                "FROM s3_accounts ORDER BY id"
            )
        ).mappings().all()
        assert restored[0]["portal_settings_override"] == json.dumps(
            payload,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        assert restored[1]["portal_settings_override"] is None


@pytest.mark.parametrize("value", ["{", "[]", '"legacy"', "null"])
def test_migration_rejects_invalid_or_non_object_override(monkeypatch, value):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    accounts = _legacy_schema(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            accounts.insert().values(id=1, portal_settings_override=value)
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="S3 account 1 portal_settings_override"):
            migration.upgrade()
