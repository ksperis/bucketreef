# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.domain_errors import StorageEndpointFeatureDisabledError
from app.db import StorageEndpoint
from app.utils.storage_endpoint_features import resolve_feature_flags


def require_sse_feature(endpoint: StorageEndpoint | None) -> None:
    if endpoint is None:
        return
    if not resolve_feature_flags(endpoint).sse_enabled:
        raise StorageEndpointFeatureDisabledError(
            "Server-side encryption is disabled for this endpoint"
        )


def require_replication_feature(endpoint: StorageEndpoint | None) -> None:
    if endpoint is None or not resolve_feature_flags(endpoint).replication_enabled:
        raise StorageEndpointFeatureDisabledError(
            "Bucket replication is disabled for this endpoint"
        )
