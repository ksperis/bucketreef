# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from app.services.identity_provider_repository import IdentityProviderRepository


_PersistedProviderT = TypeVar("_PersistedProviderT")
_AdminItemT = TypeVar("_AdminItemT")


def create_identity_provider(
    repository: IdentityProviderRepository[_PersistedProviderT],
    provider_id: str,
    *,
    normalize_provider_id: Callable[[str], str],
    apply: Callable[[_PersistedProviderT], None],
    to_item: Callable[[_PersistedProviderT], _AdminItemT],
) -> _AdminItemT:
    normalized_id = normalize_provider_id(provider_id)
    return to_item(repository.create(normalized_id, apply))


def update_identity_provider(
    repository: IdentityProviderRepository[_PersistedProviderT],
    provider_id: str,
    payload_provider_id: str,
    *,
    normalize_provider_id: Callable[[str], str],
    apply: Callable[[_PersistedProviderT], None],
    to_item: Callable[[_PersistedProviderT], _AdminItemT],
) -> _AdminItemT:
    normalized_id = normalize_provider_id(provider_id)
    normalized_payload_id = normalize_provider_id(payload_provider_id)
    if normalized_payload_id != normalized_id:
        raise ValueError("provider_id cannot be changed")
    return to_item(repository.update(normalized_id, apply))


def delete_identity_provider(
    repository: IdentityProviderRepository[_PersistedProviderT],
    provider_id: str,
    *,
    normalize_provider_id: Callable[[str], str],
) -> None:
    repository.delete(normalize_provider_id(provider_id))
