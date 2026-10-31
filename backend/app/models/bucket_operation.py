# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from collections.abc import Callable, Hashable
from typing import Annotated, TypeVar

from pydantic import AfterValidator, Field, model_validator

from app.models.base import ApiModel
from app.utils.rgw_identifiers import (
    normalize_rgw_bucket_reference_name,
    validate_rgw_tenant,
)


class RgwBucketReference(ApiModel):
    name: str
    tenant: str = ""

    @model_validator(mode="after")
    def normalize_reference(self):
        self.name = normalize_rgw_bucket_reference_name(self.name)
        self.tenant = validate_rgw_tenant((self.tenant or "").strip())
        return self


_ItemT = TypeVar("_ItemT")


def _deduplicate_by_key(
    items: list[_ItemT],
    key: Callable[[_ItemT], Hashable],
) -> list[_ItemT]:
    deduplicated: list[_ItemT] = []
    seen: set[Hashable] = set()
    for item in items:
        item_key = key(item)
        if item_key in seen:
            continue
        seen.add(item_key)
        deduplicated.append(item)
    return deduplicated


def deduplicate_rgw_bucket_references(
    targets: list[RgwBucketReference],
) -> list[RgwBucketReference]:
    return _deduplicate_by_key(targets, lambda target: (target.tenant, target.name))


class BucketOperationTarget(ApiModel):
    context_id: str
    bucket_name: str

    @model_validator(mode="after")
    def validate_target(self):
        self.context_id = (self.context_id or "").strip()
        self.bucket_name = (self.bucket_name or "").strip()
        if not self.context_id:
            raise ValueError("context_id is required.")
        if not self.bucket_name:
            raise ValueError("bucket_name is required.")
        return self


_TargetT = TypeVar("_TargetT", bound=BucketOperationTarget)


def normalize_bucket_names(bucket_names: list[str]) -> list[str]:
    return list(
        dict.fromkeys(
            bucket_name.strip()
            for bucket_name in bucket_names
            if bucket_name and bucket_name.strip()
        )
    )


def require_bucket_names(bucket_names: list[str]) -> list[str]:
    normalized = normalize_bucket_names(bucket_names)
    if not normalized:
        raise ValueError("At least one bucket is required.")
    return normalized


def deduplicate_bucket_targets(targets: list[_TargetT]) -> list[_TargetT]:
    return _deduplicate_by_key(
        targets,
        lambda target: (target.context_id, target.bucket_name),
    )


BucketNameList = Annotated[
    list[str],
    Field(min_length=1, max_length=200),
    AfterValidator(require_bucket_names),
]
BucketTargetList = Annotated[
    list[BucketOperationTarget],
    Field(min_length=1, max_length=200),
    AfterValidator(deduplicate_bucket_targets),
]
RgwBucketReferenceList = Annotated[
    list[RgwBucketReference],
    Field(min_length=1, max_length=200),
    AfterValidator(deduplicate_rgw_bucket_references),
]
