# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import Field, field_validator

from app.models.account_access import AccountAccessGrant
from app.models.base import ApiModel
from app.models.pagination import PaginatedResponse
from app.models.tagging import (
    OptionalTagDefinitionList,
    RequiredTagDefinitionList,
    TagDefinitionSummary,
)
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAvatar
from app.utils.rgw_identifiers import (
    is_rgw_account_id,
    normalize_rgw_identifier,
    validate_rgw_account_name,
    validate_rgw_tenant,
)


class AccountUserLink(AccountAccessGrant):
    allow_manager_browser_data_access: bool
    user_id: int
    user_email: Optional[str]
    user_full_name: Optional[str]
    user_avatar: Optional[UserAvatar]


class AccountGroupLink(AccountAccessGrant):
    allow_manager_browser_data_access: bool
    group_id: int
    group_name: Optional[str]
    group_avatar: Optional[UiGroupAvatar]


class AccountUserLinkInput(AccountAccessGrant):
    user_id: int


class AccountGroupLinkInput(AccountAccessGrant):
    group_id: int


class S3Account(ApiModel):
    id: int
    name: str
    rgw_account_id: str
    rgw_tenant: str
    quota_max_size_gb: Optional[float]
    quota_max_objects: Optional[int]
    email: Optional[str]
    used_bytes: Optional[int]
    used_objects: Optional[int]
    user_links: list[AccountUserLink]
    group_links: list[AccountGroupLink]
    bucket_count: Optional[int]
    rgw_user_count: Optional[int]
    rgw_user_uids: Optional[list[str]]
    rgw_topic_count: Optional[int]
    rgw_topics: Optional[list[str]]
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    storage_endpoint_is_default: bool
    storage_endpoint_capabilities: dict[str, bool]
    allow_bucket_quota_management: Optional[bool]
    allow_access_key_metadata: Optional[bool]
    allow_access_key_expiration: Optional[bool]
    allow_activity_history: Optional[bool]
    allow_rgw_usage_metrics: Optional[bool]
    allow_cost_estimation: Optional[bool]
    allow_bucket_usage_stats: Optional[bool]
    allow_bucket_usage_stats_collection: Optional[bool]
    tags: list[TagDefinitionSummary]


class S3AccountCreate(ApiModel):
    name: str
    rgw_tenant: str = ""
    email: Optional[str] = None
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    storage_endpoint_id: int
    tags: RequiredTagDefinitionList = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_account_name(cls, value: str) -> str:
        return validate_rgw_account_name(value)

    @field_validator("rgw_tenant")
    @classmethod
    def validate_tenant(cls, value: str) -> str:
        normalized = value.strip()
        return validate_rgw_tenant(normalized)


class S3AccountImport(ApiModel):
    rgw_account_id: str
    rgw_tenant: Optional[str] = None
    root_uid: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: int

    @field_validator("rgw_account_id", mode="before")
    @classmethod
    def normalize_account_id(cls, value: object) -> str:
        normalized = normalize_rgw_identifier(str(value or ""))
        if not normalized or not is_rgw_account_id(normalized):
            raise ValueError("rgw_account_id must match RGW followed by 17 digits")
        return normalized

    @field_validator("rgw_tenant")
    @classmethod
    def validate_import_tenant(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_rgw_tenant(value.strip())


class S3AccountUpdate(ApiModel):
    quota_max_size_gb: Optional[float] = None
    quota_max_size_unit: Optional[str] = None
    quota_max_objects: Optional[int] = None
    user_links: Optional[list[AccountUserLinkInput]] = None
    group_links: Optional[list[AccountGroupLinkInput]] = None
    name: Optional[str] = None
    email: Optional[str] = None
    storage_endpoint_id: Optional[int] = None
    tags: OptionalTagDefinitionList = None
    allow_bucket_quota_management: Optional[bool] = None
    allow_access_key_metadata: Optional[bool] = None
    allow_access_key_expiration: Optional[bool] = None
    allow_activity_history: Optional[bool] = None
    allow_rgw_usage_metrics: Optional[bool] = None
    allow_cost_estimation: Optional[bool] = None
    allow_bucket_usage_stats: Optional[bool] = None
    allow_bucket_usage_stats_collection: Optional[bool] = None

    @field_validator("storage_endpoint_id", mode="before")
    @classmethod
    def reject_null_storage_endpoint_id(cls, value: object) -> object:
        if value is None:
            raise ValueError("storage_endpoint_id cannot be null")
        return value

    @field_validator("user_links", "group_links", mode="before")
    @classmethod
    def reject_null_principal_links(cls, value: object) -> object:
        if value is None:
            raise ValueError("principal links cannot be null; use an empty list to clear them")
        return value


class S3AccountSummary(ApiModel):
    id: int
    name: str
    rgw_account_id: str
    rgw_tenant: str
    user_links: list[AccountUserLink]
    group_links: list[AccountGroupLink]
    storage_endpoint_id: int
    storage_endpoint_name: str
    storage_endpoint_url: str
    storage_endpoint_is_default: bool
    storage_endpoint_capabilities: dict[str, bool]
    allow_bucket_quota_management: Optional[bool]
    allow_access_key_metadata: Optional[bool]
    allow_access_key_expiration: Optional[bool]
    allow_activity_history: Optional[bool]
    allow_rgw_usage_metrics: Optional[bool]
    allow_cost_estimation: Optional[bool]
    allow_bucket_usage_stats: Optional[bool]
    allow_bucket_usage_stats_collection: Optional[bool]
    tags: list[TagDefinitionSummary]


class PaginatedS3AccountsResponse(PaginatedResponse):
    items: list[S3Account]
