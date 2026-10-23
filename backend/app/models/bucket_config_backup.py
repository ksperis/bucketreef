# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import Field, model_validator

from app.models.base import ApiModel
from app.models.bucket_operation import RgwBucketReferenceList


BucketConfigBackupFeature = Literal[
    "quota",
    "versioning",
    "object_lock",
    "public_access_block",
    "lifecycle",
    "cors",
    "policy",
    "access_logging",
    "tags",
]


class BucketConfigBackupRequest(ApiModel):
    buckets: RgwBucketReferenceList
    features: list[BucketConfigBackupFeature] = Field(..., min_length=1)

    @model_validator(mode="after")
    def normalize_values(self) -> "BucketConfigBackupRequest":
        features: list[BucketConfigBackupFeature] = []
        seen_features: set[str] = set()
        for feature in self.features:
            if feature in seen_features:
                continue
            seen_features.add(feature)
            features.append(feature)
        if not features:
            raise ValueError("At least one backup feature is required.")

        self.features = features
        return self


class BucketConfigBackupSource(ApiModel):
    surface: str
    endpoint_id: int | None
    endpoint_name: str | None


class BucketConfigBackupBucket(ApiModel):
    name: str
    tenant: str
    configuration: dict[str, Any]
    errors: dict[str, str]


class BucketConfigBackupResponse(ApiModel):
    kind: str
    version: int
    generated_at: datetime
    source: BucketConfigBackupSource
    features: list[BucketConfigBackupFeature]
    buckets: list[BucketConfigBackupBucket]
