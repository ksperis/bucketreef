# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import status

from app.core.domain_errors import StorageEndpointFeatureDisabledError
from app.db import StorageEndpoint
from app.services.storage_endpoint_feature_guards import (
    require_replication_feature as require_replication_feature_enabled,
)
from app.services.storage_endpoint_feature_guards import (
    require_sse_feature as require_sse_feature_enabled,
)
from app.utils.http_errors import raise_http_exception_from_exception


def require_sse_feature(endpoint: StorageEndpoint | None) -> None:
    try:
        require_sse_feature_enabled(endpoint)
    except StorageEndpointFeatureDisabledError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)


def require_replication_feature(endpoint: StorageEndpoint | None) -> None:
    try:
        require_replication_feature_enabled(endpoint)
    except StorageEndpointFeatureDisabledError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
