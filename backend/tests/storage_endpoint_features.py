# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.domain_enums import StorageProvider
from app.utils.storage_endpoint_features import normalize_features, parse_features_config


def persisted_endpoint_features(
    raw: str = "features: {}",
    *,
    provider: StorageProvider | str = StorageProvider.CEPH,
    region: str | None = None,
) -> dict[str, dict[str, object]]:
    """Build the canonical feature JSON expected for a persisted endpoint fixture."""
    return normalize_features(provider, parse_features_config(raw), region)
