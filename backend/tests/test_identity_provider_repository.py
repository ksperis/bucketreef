# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db import OidcProvider
from app.services.identity_provider_repository import IdentityProviderRepository


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


def _fail_commit_and_track_rollback(db_session, monkeypatch) -> list[None]:
    rollback_calls: list[None] = []
    original_rollback = db_session.rollback

    def rollback() -> None:
        rollback_calls.append(None)
        original_rollback()

    def commit() -> None:
        raise RuntimeError("commit failed")

    monkeypatch.setattr(db_session, "rollback", rollback)
    monkeypatch.setattr(db_session, "commit", commit)
    return rollback_calls


def test_update_rolls_back_when_commit_fails(db_session, monkeypatch):
    provider = _provider()
    db_session.add(provider)
    db_session.commit()
    rollback_calls = _fail_commit_and_track_rollback(db_session, monkeypatch)

    with pytest.raises(RuntimeError, match="commit failed"):
        _repository(db_session).update(
            provider.provider_id,
            lambda current: setattr(current, "display_name", "Changed"),
        )

    assert rollback_calls == [None]
    db_session.expire_all()
    stored = db_session.scalar(select(OidcProvider).where(OidcProvider.provider_id == "ui"))
    assert stored is not None
    assert stored.display_name == "Original"


def test_delete_rolls_back_when_commit_fails(db_session, monkeypatch):
    provider = _provider()
    db_session.add(provider)
    db_session.commit()
    rollback_calls = _fail_commit_and_track_rollback(db_session, monkeypatch)

    with pytest.raises(RuntimeError, match="commit failed"):
        _repository(db_session).delete(provider.provider_id)

    assert rollback_calls == [None]
    db_session.expire_all()
    assert db_session.scalar(
        select(OidcProvider).where(OidcProvider.provider_id == "ui")
    ) is not None
