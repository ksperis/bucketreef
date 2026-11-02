# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from importlib import util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.exc import IntegrityError


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0224_external_identity_provider_invariants.py"
)


def _load_migration():
    spec = util.spec_from_file_location("migration_0224_external_identity_provider_invariants", MIGRATION_PATH)
    assert spec and spec.loader
    migration = util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    return migration


def _install_operations(monkeypatch, migration, connection) -> None:
    monkeypatch.setattr(
        migration,
        "op",
        Operations(MigrationContext.configure(connection)),
    )


def _create_provider_tables(connection) -> None:
    metadata = sa.MetaData()
    for table_name in (
        "external_identities",
        "external_identity_link_requests",
        "external_identity_link_attempts",
    ):
        sa.Table(
            table_name,
            metadata,
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("provider_type", sa.String(), nullable=False),
            sa.Column("provider_id", sa.String(), nullable=False),
            sa.Column("issuer", sa.String(), nullable=True),
            sa.Column("subject", sa.String(), nullable=True),
        )
    metadata.create_all(connection)


def test_external_identity_provider_invariant_canonicalizes_and_enforces(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_provider_tables(connection)
        for table_name in (
            "external_identities",
            "external_identity_link_requests",
            "external_identity_link_attempts",
        ):
            connection.execute(
                sa.text(
                    f"INSERT INTO {table_name} (id, provider_type, provider_id, issuer, subject) "
                    "VALUES (:id, ' LDAP ', ' Company ', 'https://stale-issuer.example.test', 'ldap-subject')"
                ),
                {"id": f"{table_name}-ldap"},
            )
            connection.execute(
                sa.text(
                    f"INSERT INTO {table_name} (id, provider_type, provider_id, issuer, subject) "
                    "VALUES (:id, 'OIDC', ' Company ', ' https://issuer.example.test/// ', 'oidc-subject')"
                ),
                {"id": f"{table_name}-oidc"},
            )

        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)
        migration.upgrade()

        for table_name in (
            "external_identities",
            "external_identity_link_requests",
            "external_identity_link_attempts",
        ):
            ldap_row = connection.execute(
                sa.text(
                    f"SELECT provider_type, provider_id, issuer FROM {table_name} "
                    "WHERE subject = 'ldap-subject'"
                )
            ).mappings().one()
            assert dict(ldap_row) == {
                "provider_type": "ldap",
                "provider_id": "company",
                "issuer": None,
            }
            oidc_row = connection.execute(
                sa.text(
                    f"SELECT provider_type, provider_id, issuer FROM {table_name} "
                    "WHERE subject = 'oidc-subject'"
                )
            ).mappings().one()
            assert dict(oidc_row) == {
                "provider_type": "oidc",
                "provider_id": "company",
                "issuer": "https://issuer.example.test",
            }
            with pytest.raises(IntegrityError):
                with connection.begin_nested():
                    connection.execute(
                        sa.text(
                            f"INSERT INTO {table_name} "
                            "(id, provider_type, provider_id, issuer, subject) "
                            "VALUES (:id, 'oidc', 'company', NULL, 'invalid-issuer')"
                        ),
                        {"id": f"{table_name}-invalid"},
                    )
            with pytest.raises(IntegrityError):
                with connection.begin_nested():
                    connection.execute(
                        sa.text(
                            f"INSERT INTO {table_name} "
                            "(id, provider_type, provider_id, issuer, subject) "
                            "VALUES (:id, 'oidc', ' Company ', 'https://issuer.example.test/', 'invalid-canonical')"
                        ),
                        {"id": f"{table_name}-noncanonical"},
                    )

        migration.downgrade()

        for table_name in (
            "external_identities",
            "external_identity_link_requests",
            "external_identity_link_attempts",
        ):
            connection.execute(
                sa.text(
                    f"INSERT INTO {table_name} "
                    "(id, provider_type, provider_id, issuer, subject) "
                    "VALUES (:id, 'oidc', ' Company ', NULL, 'downgraded-invalid')"
                ),
                {"id": f"{table_name}-downgraded-invalid"},
            )


def test_external_identity_provider_invariant_rejects_unrecoverable_oidc_rows(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_provider_tables(connection)
        connection.execute(
            sa.text(
                "INSERT INTO external_identities (id, provider_type, provider_id, issuer, subject) "
                "VALUES ('broken-oidc', 'oidc', 'company', NULL, 'subject')"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="broken-oidc"):
            migration.upgrade()


def test_external_identity_provider_invariant_rejects_canonical_identity_collision(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_provider_tables(connection)
        connection.execute(
            sa.text(
                "INSERT INTO external_identities (id, provider_type, provider_id, issuer, subject) VALUES "
                "('first', 'oidc', 'company', 'https://issuer.example.test', 'subject'), "
                "('second', 'OIDC', ' Company ', 'https://issuer.example.test/', 'subject')"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="would collide"):
            migration.upgrade()


def test_external_identity_provider_invariant_rejects_invalid_provider_id(monkeypatch):
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        _create_provider_tables(connection)
        connection.execute(
            sa.text(
                "INSERT INTO external_identity_link_attempts "
                "(id, provider_type, provider_id, issuer, subject) "
                "VALUES ('invalid-provider', 'ldap', 'bad provider!', NULL, NULL)"
            )
        )
        migration = _load_migration()
        _install_operations(monkeypatch, migration, connection)

        with pytest.raises(RuntimeError, match="invalid-provider"):
            migration.upgrade()
