# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Generic, TypeVar

from app.services.identity_provider_repository import IdentityProviderRepository
from app.services.identity_provider_resolution import (
    list_effective_identity_providers,
    resolve_identity_provider_map,
)


_PersistedProviderT = TypeVar("_PersistedProviderT")
_ProviderSettingsT = TypeVar("_ProviderSettingsT")
_ProviderItemT = TypeVar("_ProviderItemT")


class IdentityProviderSettingsService(
    Generic[_PersistedProviderT, _ProviderSettingsT, _ProviderItemT]
):
    """Shared persistence and effective-settings lifecycle for identity providers."""

    def __init__(
        self,
        repository: IdentityProviderRepository[_PersistedProviderT],
        environment_providers: Mapping[str, _ProviderSettingsT],
        *,
        normalize_provider_id: Callable[[str], str],
        environment_item: Callable[[str, _ProviderSettingsT], _ProviderItemT],
        persisted_item: Callable[[_PersistedProviderT], _ProviderItemT],
        persisted_to_settings: Callable[[_PersistedProviderT], _ProviderSettingsT],
    ) -> None:
        self.repository = repository
        self.environment_providers = environment_providers
        self.normalize_provider_id = normalize_provider_id
        self.environment_item = environment_item
        self.persisted_item = persisted_item
        self.persisted_to_settings = persisted_to_settings

    def list_effective(self) -> list[_ProviderItemT]:
        return list_effective_identity_providers(
            self.environment_providers,
            self.repository.list(),
            environment_item=self.environment_item,
            persisted_item=self.persisted_item,
        )

    def resolve_map(self) -> dict[str, _ProviderSettingsT]:
        return resolve_identity_provider_map(
            self.environment_providers,
            self.repository.list(),
            persisted_to_settings=self.persisted_to_settings,
        )

    def create(
        self,
        provider_id: str,
        apply: Callable[[_PersistedProviderT], None],
    ) -> _ProviderItemT:
        normalized_id = self.normalize_provider_id(provider_id)
        return self.persisted_item(self.repository.create(normalized_id, apply))

    def update(
        self,
        provider_id: str,
        payload_provider_id: str,
        apply: Callable[[_PersistedProviderT], None],
    ) -> _ProviderItemT:
        normalized_id = self.normalize_provider_id(provider_id)
        normalized_payload_id = self.normalize_provider_id(payload_provider_id)
        if normalized_payload_id != normalized_id:
            raise ValueError("provider_id cannot be changed")
        return self.persisted_item(self.repository.update(normalized_id, apply))

    def delete(self, provider_id: str) -> None:
        self.repository.delete(self.normalize_provider_id(provider_id))
