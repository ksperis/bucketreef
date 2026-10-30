# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Optional

from pydantic import Field, model_validator

from app.models.base import ApiModel
from app.models.bucket_compare import (
    BucketCompareConfigFeature,
    BucketConfigDiff,
    BucketContentDiff,
    normalize_bucket_compare_scope,
)
from app.models.bucket_operation import RgwBucketReference


class CephAdminBucketCompareRequest(ApiModel):
    target_endpoint_id: int = Field(..., ge=1)
    source: RgwBucketReference
    target: RgwBucketReference
    include_content: bool = True
    include_config: bool = False
    config_features: Optional[list[BucketCompareConfigFeature]] = None
    ignore_modified_after: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_comparison_scope(self):
        self.config_features = normalize_bucket_compare_scope(
            include_content=self.include_content,
            include_config=self.include_config,
            config_features=self.config_features,
        )
        return self


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
