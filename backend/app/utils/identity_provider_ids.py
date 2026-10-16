# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re
from typing import TypeVar


IDENTITY_PROVIDER_ID_PATTERN = re.compile(r"^[a-z0-9_-]+$")

_ProviderT = TypeVar("_ProviderT")


def normalize_identity_provider_id(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("provider_id must be a string")
    normalized = value.strip().lower()
    if not normalized:
        raise ValueError("provider_id is required")
    if not IDENTITY_PROVIDER_ID_PATTERN.fullmatch(normalized):
        raise ValueError("provider_id may contain only lowercase letters, numbers, underscores, and hyphens")
    return normalized


def normalize_identity_provider_map(
    value: dict[object, _ProviderT] | None,
    *,
    provider_type: str,
) -> dict[str, _ProviderT]:
    normalized: dict[str, _ProviderT] = {}
    for key, provider in (value or {}).items():
        provider_id = str(key or "").strip().lower()
        if not provider_id or not IDENTITY_PROVIDER_ID_PATTERN.fullmatch(provider_id):
            raise ValueError(f"{provider_type} provider keys must match [a-z0-9_-]+")
        if provider_id in normalized:
            raise ValueError(f"Duplicate {provider_type} provider key after normalization: {provider_id}")
        normalized[provider_id] = provider
    return normalized


def identity_provider_environment_source(prefix: str, provider_id: str, field: str) -> str:
    base = f"{prefix}__{provider_id.upper()}"
    return base if field == "provider_id" else f"{base}__{field.upper()}"
