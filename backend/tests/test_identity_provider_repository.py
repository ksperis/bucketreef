# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db import OidcProvider
from app.services.identity_provider_repository import IdentityProviderRepository
from tests.db_transaction_test_utils import (
    fail_next_sqlite_statement_with_busy_snapshot,
    fail_next_transaction_commit,
)


def _provider(provider_id: str = "ui") -> OidcProvider:
    return OidcProvider(
        provider_id=provider_id,
        display_name="Original",
        discovery_url="https://issuer.example.test/.well-known/openid-configuration",
        client_id="client-id",
        client_secret="secret",
        redirect_uri="https://app.example.test/auth/callback",
        scopes=["openid", "email"],
        enabled=True,
        use_pkce=True,
        use_nonce=True,
    )


def _repository(db_session) -> IdentityProviderRepository[OidcProvider]:
    return IdentityProviderRepository(db_session, OidcProvider, {}, "OIDC")


def test_update_rolls_back_when_commit_fails(db_session):
    provider = _provider()
    db_session.add(provider)
    db_session.commit()

    with fail_next_transaction_commit(db_session):
        with pytest.raises(RuntimeError, match="commit failed"):
            _repository(db_session).update(
                provider.provider_id,
                lambda current: setattr(current, "display_name", "Changed"),
            )

    db_session.expire_all()
    stored = db_session.scalar(select(OidcProvider).where(OidcProvider.provider_id == "ui"))
    assert stored is not None
    assert stored.display_name == "Original"


def test_delete_rolls_back_when_commit_fails(db_session):
    provider = _provider()
    db_session.add(provider)
    db_session.commit()

    with fail_next_transaction_commit(db_session):
        with pytest.raises(RuntimeError, match="commit failed"):
            _repository(db_session).delete(provider.provider_id)

    db_session.expire_all()
    assert db_session.scalar(
        select(OidcProvider).where(OidcProvider.provider_id == "ui")
    ) is not None


def test_create_retries_sqlite_busy_snapshot(db_session):
    repository = _repository(db_session)

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "INSERT INTO oidc_providers",
    ) as matching_statements:
        created = repository.create(
            "retry-create",
            lambda current: (
                setattr(current, "display_name", "Retry"),
                setattr(current, "discovery_url", "https://issuer.example.test/.well-known/openid-configuration"),
                setattr(current, "client_id", "client-id"),
                setattr(current, "client_secret", "secret"),
                setattr(current, "redirect_uri", "https://app.example.test/auth/callback"),
                setattr(current, "scopes", ["openid", "email"]),
                setattr(current, "enabled", True),
                setattr(current, "use_pkce", True),
                setattr(current, "use_nonce", True),
            ),
        )

    assert len(matching_statements) == 2
    assert created.provider_id == "retry-create"
    assert created.display_name == "Retry"
    assert created.created_at is not None
    assert created.updated_at == created.created_at


def test_update_retries_sqlite_busy_snapshot(db_session):
    provider = _provider("retry-update")
    db_session.add(provider)
    db_session.commit()

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "UPDATE oidc_providers",
    ) as matching_statements:
        updated = _repository(db_session).update(
            provider.provider_id,
            lambda current: setattr(current, "display_name", "Changed"),
        )

    assert len(matching_statements) == 2
    assert updated.display_name == "Changed"


def test_delete_retries_sqlite_busy_snapshot(db_session):
    provider = _provider("retry-delete")
    db_session.add(provider)
    db_session.commit()
    provider_id = provider.provider_id

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "DELETE FROM oidc_providers",
    ) as matching_statements:
        _repository(db_session).delete(provider_id)

    assert len(matching_statements) == 2
    assert db_session.scalar(
        select(OidcProvider).where(OidcProvider.provider_id == provider_id)
    ) is None
