# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import TypeVar


_PersistedProviderT = TypeVar("_PersistedProviderT")
_ProviderSettingsT = TypeVar("_ProviderSettingsT")
_ProviderItemT = TypeVar("_ProviderItemT")


def list_effective_identity_providers(
    environment_providers: Mapping[str, _ProviderSettingsT],
    persisted_providers: Iterable[_PersistedProviderT],
    *,
    environment_item: Callable[[str, _ProviderSettingsT], _ProviderItemT],
    persisted_item: Callable[[_PersistedProviderT], _ProviderItemT],
) -> list[_ProviderItemT]:
    items = [
        environment_item(provider_id, provider)
        for provider_id, provider in environment_providers.items()
    ]
    for provider in persisted_providers:
        provider_id = str(provider.provider_id).lower()
        if provider_id not in environment_providers:
            items.append(persisted_item(provider))
    return items


def resolve_identity_provider_map(
    environment_providers: Mapping[str, _ProviderSettingsT],
    persisted_providers: Iterable[_PersistedProviderT],
    *,
    persisted_to_settings: Callable[[_PersistedProviderT], _ProviderSettingsT],
) -> dict[str, _ProviderSettingsT]:
    resolved = dict(environment_providers)
    for provider in persisted_providers:
        provider_id = str(provider.provider_id).lower()
        if provider_id not in resolved:
            resolved[provider_id] = persisted_to_settings(provider)
    return resolved
