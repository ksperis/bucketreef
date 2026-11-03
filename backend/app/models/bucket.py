# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Any, Optional, List, Literal

from pydantic import field_validator, model_validator

from app.models.base import ApiModel
from app.models.pagination import PaginatedResponse
from app.utils.normalize import normalize_optional_scalar


class BucketTag(ApiModel):
    key: str
    value: str


class BucketFeatureStatus(ApiModel):
    state: str
    tone: Literal["active", "inactive", "unknown"]


class Bucket(ApiModel):
    name: str
    tenant: Optional[str] = None
    creation_date: Optional[datetime] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    tags: Optional[List[BucketTag]] = None
    features: Optional[dict[str, BucketFeatureStatus]] = None


class BucketOption(ApiModel):
    name: str


class PaginatedBucketOptionsResponse(PaginatedResponse):
    items: list[BucketOption]


class BucketPublicAccessBlock(ApiModel):
    block_public_acls: Optional[bool]
    ignore_public_acls: Optional[bool]
    block_public_policy: Optional[bool]
    restrict_public_buckets: Optional[bool]


class BucketPublicAccessBlockUpdate(ApiModel):
    block_public_acls: bool
    ignore_public_acls: bool
    block_public_policy: bool
    restrict_public_buckets: bool


class BucketCreate(ApiModel):
    name: str
    versioning: bool
    location_constraint: Optional[str] = None

    _normalize_location_constraint = field_validator("location_constraint", mode="before")(
        normalize_optional_scalar
    )


class BucketVersioningUpdate(ApiModel):
    enabled: bool


class BucketVersioningStatus(ApiModel):
    status: Optional[str]
    enabled: bool


class BucketPolicyIn(ApiModel):
    policy: dict


class BucketPolicyOut(ApiModel):
    policy: Optional[dict]


class LifecycleRule(ApiModel):
    id: Optional[str] = None
    status: Optional[str] = None
    prefix: Optional[str] = None


class BucketLifecycleConfig(ApiModel):
    rules: List[dict]


class BucketTags(ApiModel):
    tags: List[BucketTag]


class BucketTagsUpdate(ApiModel):
    tags: List[BucketTag]


class BucketObjectLock(ApiModel):
    enabled: Optional[bool]
    mode: Optional[str]
    days: Optional[int]
    years: Optional[int]


class BucketObjectLockUpdate(ApiModel):
    enabled: Optional[bool]
    mode: Optional[str]
    days: Optional[int]
    years: Optional[int]

    @field_validator("days", "years")
    @classmethod
    def validate_positive(cls, value: Optional[int]) -> Optional[int]:
        if value is not None and value < 0:
            raise ValueError("Retention must be positive.")
        return value

    @model_validator(mode="after")
    def validate_retention(self) -> "BucketObjectLockUpdate":
        days = self.days
        years = self.years
        mode = self.mode
        if days is not None and years is not None:
            raise ValueError("Specify either Days or Years, not both.")
        if (days is not None or years is not None) and not mode:
            raise ValueError("Mode is required to set a default retention.")
        return self


class BucketProperties(ApiModel):
    versioning_status: Optional[str] = None
    object_lock: Optional[BucketObjectLock] = None
    public_access_block: Optional[BucketPublicAccessBlock] = None
    lifecycle_rules: List[LifecycleRule]
    cors_rules: Optional[list[dict]] = None


class BucketAclGrantee(ApiModel):
    type: str
    id: Optional[str] = None
    display_name: Optional[str] = None
    uri: Optional[str] = None


class BucketAclGrant(ApiModel):
    grantee: BucketAclGrantee
    permission: str


class BucketAcl(ApiModel):
    owner: Optional[str] = None
    grants: List[BucketAclGrant]


class BucketAclUpdate(ApiModel):
    acl: str


class BucketQuotaUpdate(ApiModel):
    enabled: bool
    max_size_gb: Optional[float] = None
    max_size_unit: Optional[str] = None
    max_objects: Optional[int] = None

    @model_validator(mode="after")
    def validate_quota_contract(self) -> "BucketQuotaUpdate":
        if self.max_size_gb is None and self.max_size_unit is not None:
            raise ValueError("max_size_unit requires max_size_gb.")
        if self.max_size_gb is not None and self.max_size_unit is None:
            raise ValueError("max_size_unit is required when max_size_gb is set.")
        if self.enabled:
            if self.max_size_gb is None and self.max_objects is None:
                raise ValueError("An enabled quota requires at least one limit.")
        elif self.max_size_gb is not None or self.max_objects is not None:
            raise ValueError("A disabled quota cannot include limits.")
        return self


class BucketCorsUpdate(ApiModel):
    rules: list[dict]


class BucketCors(ApiModel):
    rules: list[dict]


class BucketEncryptionConfiguration(ApiModel):
    rules: list[dict]


class BucketNotificationConfiguration(ApiModel):
    configuration: dict


FeatureRuleInventoryFeature = Literal["lifecycle", "policy", "cors", "notifications", "tags"]
FeatureRuleInventoryStatus = Literal["configured", "empty", "unavailable"]


class FeatureRuleInventoryRule(ApiModel):
    id: str
    type: str
    title: str
    summary: str
    chips: list[str]
    raw: dict[str, Any]


class FeatureRuleInventoryBucket(ApiModel):
    bucket_name: str
    feature: FeatureRuleInventoryFeature
    status: FeatureRuleInventoryStatus
    rules: list[FeatureRuleInventoryRule]
    error: Optional[str]


class BucketReplicationConfiguration(ApiModel):
    configuration: dict


class BucketLoggingConfiguration(ApiModel):
    enabled: bool
    target_bucket: Optional[str]
    target_prefix: Optional[str]


class BucketWebsiteRedirectAllRequestsTo(ApiModel):
    host_name: str
    protocol: Optional[str] = None


class BucketWebsiteConfiguration(ApiModel):
    index_document: Optional[str]
    error_document: Optional[str]
    redirect_all_requests_to: Optional[BucketWebsiteRedirectAllRequestsTo]
    routing_rules: List[dict]


class BucketWebsiteUpdate(ApiModel):
    index_document: Optional[str]
    error_document: Optional[str]
    redirect_all_requests_to: Optional[BucketWebsiteRedirectAllRequestsTo]
    routing_rules: List[dict]
