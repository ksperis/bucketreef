# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.core.domain_errors import StorageEndpointFeatureDisabledError
from app.services.storage_endpoint_feature_guards import (
    require_replication_feature,
    require_sse_feature,
)


def test_sse_feature_allows_targets_without_storage_endpoint() -> None:
    require_sse_feature(None)


def test_replication_feature_rejects_targets_without_storage_endpoint() -> None:
    with pytest.raises(StorageEndpointFeatureDisabledError) as exc:
        require_replication_feature(None)

    assert str(exc.value) == "Bucket replication is disabled for this endpoint"
