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
        / "0203_structure_oidc_provider_lists.py"
    )
    spec = util.spec_from_file_location(
        "migration_0203_structure_oidc_provider_lists",
        path,
    )
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _oidc_providers(metadata: sa.MetaData) -> sa.Table:
    return sa.Table(
        "oidc_providers",
        metadata,
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "scopes_json",
            sa.Text(),
            nullable=False,
            server_default='["openid","email","profile"]',
        ),
        sa.Column(
            "trusted_email_domains_json",
            sa.Text(),
            nullable=False,
            server_default="[]",
        ),
    )


def test_migration_materializes_structured_lists_and_drops_text(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    providers = _oidc_providers(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            providers.insert().values(
                id=1,
                scopes_json=json.dumps(["openid", "email"]),
                trusted_email_domains_json=json.dumps(["example.com"]),
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        migration.upgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("oidc_providers")
        }
        assert "scopes" in columns
        assert "trusted_email_domains" in columns
        assert "scopes_json" not in columns
        assert "trusted_email_domains_json" not in columns
        row = connection.execute(
            sa.text(
                "SELECT scopes, trusted_email_domains "
                "FROM oidc_providers WHERE id = 1"
            )
        ).one()
        processor = sa.JSON().result_processor(connection.dialect, None)
        assert processor(row.scopes) == ["openid", "email"]
        assert processor(row.trusted_email_domains) == ["example.com"]

        migration.downgrade()

        columns = {
            column["name"]
            for column in sa.inspect(connection).get_columns("oidc_providers")
        }
        assert "scopes" not in columns
        assert "trusted_email_domains" not in columns
        assert "scopes_json" in columns
        assert "trusted_email_domains_json" in columns
        restored = connection.execute(
            sa.text(
                "SELECT scopes_json, trusted_email_domains_json "
                "FROM oidc_providers WHERE id = 1"
            )
        ).one()
        assert json.loads(restored.scopes_json) == ["openid", "email"]
        assert json.loads(restored.trusted_email_domains_json) == ["example.com"]


@pytest.mark.parametrize(
    ("scopes_json", "domains_json"),
    [
        ("{", "[]"),
        ("{}", "[]"),
        ("[]", "[]"),
        (json.dumps(["openid", 42]), "[]"),
        (json.dumps(["openid"]), "{"),
        (json.dumps(["openid"]), "{}"),
        (json.dumps(["openid"]), json.dumps(["example.com", 42])),
    ],
)
def test_migration_rejects_invalid_persisted_lists(
    monkeypatch,
    scopes_json,
    domains_json,
):
    engine = sa.create_engine("sqlite:///:memory:")
    metadata = sa.MetaData()
    providers = _oidc_providers(metadata)
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(
            providers.insert().values(
                id=1,
                scopes_json=scopes_json,
                trusted_email_domains_json=domains_json,
            )
        )
        migration = _load_migration()
        monkeypatch.setattr(
            migration,
            "op",
            Operations(MigrationContext.configure(connection)),
        )

        with pytest.raises(ValueError, match="OIDC provider 1"):
            migration.upgrade()
