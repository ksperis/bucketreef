# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import (
    EmailStr,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    field_validator,
    model_validator,
)

from app.models.base import ApiModel


PortalAdminRequestType = Literal[
    "portal_user_access",
    "portal_user_removal",
    "account_quota_change",
    "portal_setting_change",
]
PortalAdminRequestStatus = Literal["pending", "processing", "approved", "rejected", "failed"]
PortalQuotaDirection = Literal["increase", "decrease"]
PortalQuotaUnit = Literal["MiB", "GiB", "TiB"]
PortalSettingChangeMode = Literal["inherit", "override"]
PortalSettingKey = Literal[
    "browser_access_enabled",
    "allow_private_storage_space_create",
    "allow_portal_named_bucket_create",
    "allow_portal_user_access_key_create",
    "allow_portal_user_external_sharing",
    "server_access_logging_enabled",
    "storage_space_version_cleanup_enabled",
    "bucket_defaults.versioning",
    "bucket_defaults.enable_lifecycle",
    "bucket_defaults.enable_cors",
    "bucket_defaults.noncurrent_version_expiration_days",
    "bucket_defaults.cors_allowed_origins",
]
PortalSettingValue = Union[StrictBool, StrictInt, list[StrictStr]]

_PORTAL_BOOLEAN_SETTING_KEYS = {
    "browser_access_enabled",
    "allow_private_storage_space_create",
    "allow_portal_named_bucket_create",
    "allow_portal_user_access_key_create",
    "allow_portal_user_external_sharing",
    "server_access_logging_enabled",
    "storage_space_version_cleanup_enabled",
    "bucket_defaults.versioning",
    "bucket_defaults.enable_lifecycle",
    "bucket_defaults.enable_cors",
}


def _normalize_optional_request_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned or None


class PortalUserAccessRequestCreate(ApiModel):
    request_type: Literal["portal_user_access"]
    target_name: str = Field(min_length=1, max_length=120)
    target_email: EmailStr
    reason: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("target_name")
    @classmethod
    def _normalize_target_name(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Name is required")
        return cleaned

    _normalize_reason = field_validator("reason")(_normalize_optional_request_text)


class PortalUserRemovalRequestCreate(ApiModel):
    request_type: Literal["portal_user_removal"]
    target_email: EmailStr
    target_name: Optional[str] = Field(default=None, max_length=120)
    reason: Optional[str] = Field(default=None, max_length=2000)

    _normalize_optional_text = field_validator("target_name", "reason")(_normalize_optional_request_text)


class PortalAccountQuotaChangeRequestCreate(ApiModel):
    request_type: Literal["account_quota_change"]
    direction: PortalQuotaDirection
    target_quota_value: float = Field(gt=0)
    target_quota_unit: PortalQuotaUnit = "GiB"
    reason: Optional[str] = Field(default=None, max_length=2000)

    _normalize_reason = field_validator("reason")(_normalize_optional_request_text)


class PortalSettingChangeRequestCreate(ApiModel):
    request_type: Literal["portal_setting_change"]
    setting: PortalSettingKey
    mode: PortalSettingChangeMode
    value: Optional[PortalSettingValue] = None
    reason: Optional[str] = Field(default=None, max_length=2000)

    _normalize_reason = field_validator("reason")(_normalize_optional_request_text)

    @model_validator(mode="after")
    def _validate_requested_value(self) -> "PortalSettingChangeRequestCreate":
        if self.mode == "inherit":
            if self.value is not None:
                raise ValueError("value must be omitted when mode is inherit")
            return self
        if self.value is None:
            raise ValueError("value is required when mode is override")
        if self.setting in _PORTAL_BOOLEAN_SETTING_KEYS:
            if not isinstance(self.value, bool):
                raise ValueError("value must be a boolean for this setting")
            return self
        if self.setting == "bucket_defaults.noncurrent_version_expiration_days":
            if isinstance(self.value, bool) or not isinstance(self.value, int) or self.value < 1:
                raise ValueError("value must be a positive integer for this setting")
            return self
        if self.setting == "bucket_defaults.cors_allowed_origins":
            if not isinstance(self.value, list):
                raise ValueError("value must be a string list for this setting")
            return self
        raise ValueError("Unsupported Portal setting")


PortalAdminRequestCreate = Annotated[
    Union[
        PortalUserAccessRequestCreate,
        PortalUserRemovalRequestCreate,
        PortalAccountQuotaChangeRequestCreate,
        PortalSettingChangeRequestCreate,
    ],
    Field(discriminator="request_type"),
]


class PortalAdminRequestMessageCreate(ApiModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message")
    @classmethod
    def _normalize_message(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if not cleaned:
            raise ValueError("Message is required")
        return cleaned


class PortalAdminRequestDecision(ApiModel):
    message: Optional[str] = Field(default=None, max_length=2000)

    _normalize_optional_message = field_validator("message")(_normalize_optional_request_text)


class PortalAdminRequestMessageOut(ApiModel):
    id: int
    author_user_id: Optional[int] = None
    author_email: str
    author_role: Optional[str] = None
    message: str
    created_at: datetime


class PortalAdminRequestOut(ApiModel):
    id: int
    account_id: int
    account_name: Optional[str] = None
    request_type: PortalAdminRequestType
    status: PortalAdminRequestStatus
    payload: dict[str, Any]
    result: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    requester_user_id: Optional[int] = None
    requester_email: str
    decided_by_user_id: Optional[int] = None
    decided_by_email: Optional[str] = None
    decided_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    messages: list[PortalAdminRequestMessageOut] = Field(default_factory=list)
