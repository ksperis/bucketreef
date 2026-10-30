# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from importlib import util
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations


def _load_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "0221_identity_link_request_context.py"
    )
    spec = util.spec_from_file_location("migration_0221_identity_link_request_context", path)
    assert spec is not None and spec.loader is not None
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _column_names(connection) -> set[str]:
    return {
        str(column["name"])
        for column in sa.inspect(connection).get_columns("external_identity_link_requests")
    }


def test_identity_link_request_context_migration_upgrade_and_downgrade(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        metadata = sa.MetaData()
        requests = sa.Table(
            "external_identity_link_requests",
            metadata,
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("email", sa.String(), nullable=False),
        )
        metadata.create_all(connection)
        connection.execute(
            requests.insert().values(id="legacy-request", email="legacy@example.test")
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        assert {"email_verified", "request_source"}.issubset(_column_names(connection))
        upgraded = connection.execute(
            sa.text(
                "SELECT email_verified, request_source "
                "FROM external_identity_link_requests WHERE id = :id"
            ),
            {"id": "legacy-request"},
        ).one()
        assert bool(upgraded.email_verified) is False
        assert upgraded.request_source is None

        migration.downgrade()

        assert "email_verified" not in _column_names(connection)
        assert "request_source" not in _column_names(connection)
