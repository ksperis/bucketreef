# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.bucket_compare import (
    BucketCompareScopeRequest,
    BucketConfigDiff,
    BucketContentDiff,
)
from app.models.bucket_operation import RgwBucketReference


class CephAdminBucketCompareRequest(BucketCompareScopeRequest):
    target_endpoint_id: int = Field(..., ge=1)
    source: RgwBucketReference
    target: RgwBucketReference


class CephAdminBucketCompareResult(ApiModel):
    source_endpoint_id: int
    target_endpoint_id: int
    source_bucket: str
    target_bucket: str
    source_tenant: str
    target_tenant: str
    has_differences: bool
    content_diff: Optional[BucketContentDiff]
    config_diff: Optional[BucketConfigDiff]
