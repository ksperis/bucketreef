# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime
from typing import Any, Optional, Literal

from pydantic import Field, ValidationError, ValidationInfo, field_validator, model_validator

from app.models.base import ApiModel
from app.models.bucket_listing import BucketListingSummary
from app.models.pagination import PaginatedResponse
from app.models.tagging import TagDefinitionSummary
from app.utils.rgw_identifiers import validate_rgw_account_name, validate_rgw_tenant, validate_rgw_user_uid
from app.utils.rgw_account_extra_params import validate_rgw_account_extra_params


def _safe_rgw_user_extra_params(value: dict[str, Any]) -> dict[str, Any]:
    protected = {
        "uid", "tenant", "account-id", "account-root", "format",
        "generate-key", "access-key", "secret-key", "key", "key-type",
    }
    for key, item in value.items():
        key_label = str(key).strip()
        if key_label.lower().replace("_", "-") not in protected:
            continue
        error = ValueError("User identity and credential parameters must use dedicated fields")
        raise ValidationError.from_exception_data(
            "CephAdminRgwUserExtraParams",
            [{"type": "value_error", "loc": (key_label,), "input": item, "ctx": {"error": error}}],
        ) from error
    return value

class CephAdminEndpoint(ApiModel):
    id: int
    name: str
    endpoint_url: str
    admin_endpoint: Optional[str]
    region: Optional[str]
    is_default: bool
    capabilities: dict[str, bool]
    tags: list[TagDefinitionSummary]


class CephAdminEndpointAccess(ApiModel):
    endpoint_id: int
    can_admin: bool
    can_accounts: bool
    can_metrics: bool
    admin_warning: Optional[str]
    accounts_warning: Optional[str]
    active_rgw_uid: Optional[str]
    active_rgw_tenant: Optional[str]
    availability_status: Literal["unknown", "available", "unavailable", "denied", "misconfigured"]
    availability_checked_at: Optional[str]


class CephAdminAdminOpsResult(ApiModel):
    operation: str
    success: bool
    rgw_status_code: Optional[int]
    rgw_error_code: Optional[str]
    message: str
    result: Any


class CephAdminAdminOpsConfirmation(ApiModel):
    confirmation: str = Field(min_length=1, max_length=512)


class CephAdminUserDeleteRequest(CephAdminAdminOpsConfirmation):
    purge_data: bool = False


class CephAdminBucketDeleteRequest(CephAdminAdminOpsConfirmation):
    purge_objects: bool = False
    bypass_gc: bool = False

    @model_validator(mode="after")
    def validate_bypass_gc(self):
        if self.bypass_gc and not self.purge_objects:
            raise ValueError("bypass_gc requires purge_objects.")
        return self


class CephAdminBucketLinkRequest(CephAdminAdminOpsConfirmation):
    target_type: Literal["user", "account"]
    target_id: str = Field(min_length=1, max_length=255)


class CephAdminRgwAccountSummary(ApiModel):
    account_id: str
    tenant: Optional[str] = None
    account_name: Optional[str] = None
    email: Optional[str] = None
    max_users: Optional[int] = None
    max_buckets: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None
    bucket_count: Optional[int] = None
    user_count: Optional[int] = None


class CephAdminRgwUserSummary(ApiModel):
    uid: str
    tenant: Optional[str] = None
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    suspended: Optional[bool] = None
    max_buckets: Optional[int] = None
    quota_max_size_bytes: Optional[int] = None
    quota_max_objects: Optional[int] = None
    used_bytes: Optional[int] = None
    object_count: Optional[int] = None


class PaginatedCephAdminBucketsResponse(PaginatedResponse):
    items: list[BucketListingSummary]
    stats_available: bool
    stats_warning: Optional[str]


class CephAdminBucketListingCacheRefreshResponse(ApiModel):
    refreshed: bool
    endpoint_id: int


class PaginatedCephAdminAccountsResponse(PaginatedResponse):
    items: list[CephAdminRgwAccountSummary]


class PaginatedCephAdminUsersResponse(PaginatedResponse):
    items: list[CephAdminRgwUserSummary]


class CephAdminRgwQuotaConfig(ApiModel):
    enabled: Optional[bool] = None
    max_size_bytes: Optional[int] = None
    max_objects: Optional[int] = None


class CephAdminRgwAccessKey(ApiModel):
    access_key: str
    status: Optional[str] = None
    is_active: Optional[bool] = None
    created_at: Optional[datetime] = None
    user: Optional[str] = None
    subuser: Optional[str] = None
    is_private_access_managed: bool = False
    managed_connection_id: Optional[int] = None


class CephAdminRgwGeneratedAccessKey(ApiModel):
    access_key: str
    secret_key: str


class CephAdminRgwAccessKeyStatusChange(ApiModel):
    active: bool


class CephAdminRgwAccountDetail(ApiModel):
    account_id: str
    tenant: Optional[str]
    account_name: Optional[str]
    email: Optional[str]
    max_users: Optional[int]
    max_buckets: Optional[int]
    max_roles: Optional[int]
    max_groups: Optional[int]
    max_access_keys: Optional[int]
    bucket_count: Optional[int]
    user_count: Optional[int]
    quota: Optional[CephAdminRgwQuotaConfig]
    bucket_quota: Optional[CephAdminRgwQuotaConfig]


class CephAdminRgwUserDetail(ApiModel):
    uid: str
    tenant: Optional[str]
    display_name: Optional[str]
    email: Optional[str]
    account_id: Optional[str]
    account_name: Optional[str]
    suspended: Optional[bool]
    admin: Optional[bool]
    system: Optional[bool]
    account_root: Optional[bool]
    max_buckets: Optional[int]
    op_mask: Optional[str]
    default_placement: Optional[str]
    default_storage_class: Optional[str]
    caps: list[str]
    quota: Optional[CephAdminRgwQuotaConfig]
    keys: list[CephAdminRgwAccessKey]


class CephAdminRgwUserCapsUpdate(ApiModel):
    mode: Literal["replace", "add", "remove"]
    values: list[str]


class CephAdminRgwAccountCreate(ApiModel):
    account_id: Optional[str] = None
    account_name: str
    tenant: Optional[str] = None
    email: Optional[str] = None
    max_users: Optional[int] = Field(default=None, ge=0)
    max_buckets: Optional[int] = Field(default=None, ge=0)
    max_roles: Optional[int] = Field(default=None, ge=0)
    max_groups: Optional[int] = Field(default=None, ge=0)
    max_access_keys: Optional[int] = Field(default=None, ge=0)
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    bucket_quota_enabled: Optional[bool] = None
    bucket_quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    bucket_quota_max_objects: Optional[int] = Field(default=None, ge=0)
    extra_params: dict[str, Any] = Field(default_factory=dict)

    _validate_extra_params = field_validator("extra_params")(
        validate_rgw_account_extra_params
    )

    @field_validator("tenant")
    @classmethod
    def validate_tenant(_cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        validate_rgw_tenant(normalized)
        return normalized or None

    @model_validator(mode="after")
    def validate_name(self):
        validate_rgw_account_name(self.account_name)
        if isinstance(self.account_id, str) and not self.account_id.strip():
            self.account_id = None
        return self


class CephAdminRgwAccountCreateResponse(ApiModel):
    account: CephAdminRgwAccountDetail


class CephAdminRgwUserCreate(ApiModel):
    tenant: Optional[str] = None
    uid: str
    account_id: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None
    suspended: Optional[bool] = None
    max_buckets: Optional[int] = Field(default=None, ge=0)
    op_mask: Optional[str] = None
    system: Optional[bool] = None
    account_root: Optional[bool] = None
    generate_key: bool
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    caps: Optional[CephAdminRgwUserCapsUpdate] = None
    extra_params: dict[str, Any] = Field(default_factory=dict)

    @field_validator("tenant")
    @classmethod
    def validate_tenant(_cls, value: str | None) -> str | None:
        if value:
            validate_rgw_tenant(value.strip())
        return value

    @field_validator("uid")
    @classmethod
    def validate_uid(_cls, value: str, info: ValidationInfo) -> str:
        return validate_rgw_user_uid(value, info.data.get("tenant"))

    _validate_extra_identifiers = field_validator("extra_params")(
        _safe_rgw_user_extra_params
    )

class CephAdminRgwUserCreateResponse(ApiModel):
    detail: CephAdminRgwUserDetail
    generated_key: Optional[CephAdminRgwGeneratedAccessKey]


class CephAdminRgwAccountConfigUpdate(ApiModel):
    account_name: Optional[str] = None
    email: Optional[str] = None
    max_users: Optional[int] = Field(default=None, ge=0)
    max_buckets: Optional[int] = Field(default=None, ge=0)
    max_roles: Optional[int] = Field(default=None, ge=0)
    max_groups: Optional[int] = Field(default=None, ge=0)
    max_access_keys: Optional[int] = Field(default=None, ge=0)
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    bucket_quota_enabled: Optional[bool] = None
    bucket_quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    bucket_quota_max_objects: Optional[int] = Field(default=None, ge=0)
    extra_params: dict[str, Any] = Field(default_factory=dict)

    _validate_extra_params = field_validator("extra_params")(
        validate_rgw_account_extra_params
    )


class CephAdminRgwUserConfigUpdate(ApiModel):
    display_name: Optional[str] = None
    email: Optional[str] = None
    suspended: Optional[bool] = None
    max_buckets: Optional[int] = Field(default=None, ge=0)
    op_mask: Optional[str] = None
    system: Optional[bool] = None
    account_root: Optional[bool] = None
    quota_enabled: Optional[bool] = None
    quota_max_size_bytes: Optional[int] = Field(default=None, ge=0)
    quota_max_objects: Optional[int] = Field(default=None, ge=0)
    caps: Optional[CephAdminRgwUserCapsUpdate] = None
    extra_params: dict[str, Any] = Field(default_factory=dict)

    _validate_extra_identifiers = field_validator("extra_params")(
        _safe_rgw_user_extra_params
    )


class CephAdminBucketUsagePoint(ApiModel):
    name: str
    used_bytes: Optional[int]
    object_count: Optional[int]


class CephAdminEntityMetrics(ApiModel):
    total_bytes: Optional[int]
    total_objects: Optional[int]
    bucket_count: int
    bucket_usage: list[CephAdminBucketUsagePoint]
    generated_at: datetime


class CephAdminClusterOwnerUsagePoint(ApiModel):
    owner: str
    used_bytes: Optional[int]
    object_count: Optional[int]
    bucket_count: int


class CephAdminClusterStorageTotals(ApiModel):
    used_bytes: Optional[int]
    object_count: Optional[int]
    bucket_count: int
    owners_with_usage: int


class CephAdminClusterStorageMetrics(ApiModel):
    total_buckets: int
    bucket_usage: list[CephAdminBucketUsagePoint]
    owner_usage: list[CephAdminClusterOwnerUsagePoint]
    storage_totals: CephAdminClusterStorageTotals
    generated_at: datetime
