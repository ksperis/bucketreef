# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import model_validator

from app.models.base import ApiModel


BucketCompareConfigFeature = Literal[
    "versioning_status",
    "object_lock",
    "public_access_block",
    "lifecycle_rules",
    "cors_rules",
    "bucket_policy",
    "access_logging",
    "tags",
]


class BucketCompareRequestBase(ApiModel):
    source_bucket: str
    target_bucket: str
    include_content: bool = True
    include_config: bool = False
    config_features: Optional[list[BucketCompareConfigFeature]] = None
    ignore_modified_after: Optional[datetime] = None

    @model_validator(mode="after")
    def validate_comparison_scope(self):
        self.source_bucket = (self.source_bucket or "").strip()
        self.target_bucket = (self.target_bucket or "").strip()
        if not self.source_bucket:
            raise ValueError("source_bucket is required.")
        if not self.target_bucket:
            raise ValueError("target_bucket is required.")
        if not self.include_content and not self.include_config:
            raise ValueError("At least one comparison scope must be enabled.")
        if self.config_features is not None:
            self.config_features = list(dict.fromkeys(self.config_features))
            if self.include_config and not self.config_features:
                raise ValueError(
                    "At least one config feature must be enabled when include_config is true."
                )
        return self


class BucketObjectDetail(ApiModel):
    key: str
    size: Optional[int]
    etag: Optional[str]
    last_modified: Optional[datetime]
    storage_class: Optional[str]


class BucketObjectDiffEntry(ApiModel):
    key: str
    source_size: Optional[int]
    target_size: Optional[int]
    source_etag: Optional[str]
    target_etag: Optional[str]
    source_last_modified: Optional[datetime]
    target_last_modified: Optional[datetime]
    source_storage_class: Optional[str]
    target_storage_class: Optional[str]
    compare_by: Literal["md5", "size"]


class BucketContentDiff(ApiModel):
    source_count: int
    target_count: int
    matched_count: int
    different_count: int
    only_source_count: int
    only_target_count: int
    ignored_after_cutoff_count: int
    display_limit: int
    only_source_hidden_count: int
    only_target_hidden_count: int
    different_hidden_count: int
    only_source_sample: list[str]
    only_target_sample: list[str]
    only_source_details: list[BucketObjectDetail]
    only_target_details: list[BucketObjectDetail]
    different_sample: list[BucketObjectDiffEntry]


class BucketConfigDiffSection(ApiModel):
    key: str
    label: str
    source: Any
    target: Any
    changed: bool


class BucketConfigDiff(ApiModel):
    changed: bool
    sections: list[BucketConfigDiffSection]
