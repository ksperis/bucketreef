# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Admin models for S3 connections."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional, Self

from pydantic import model_validator

from app.models.admin_listing import AdminSortableListingRequest
from app.models.base import ApiModel, reject_explicit_null_fields
from app.models.pagination import PaginatedResponse
from app.models.tagging import (
    OptionalTagDefinitionList,
    TagDefinitionSummary,
)
from app.models.s3_connection import (
    CanonicalS3ConnectionEndpointPayload,
    S3ConnectionCreationPayload,
    S3ConnectionCredentialsUpdate,
)
from app.models.ui_group import UiGroupAvatar
from app.models.user import UserAssociationDetail, UserAvatar


S3ConnectionAdminSortBy = Literal[
    "name",
    "endpoint",
    "owner",
    "last_used_at",
    "created_at",
]


class S3ConnectionAdminListingRequest(AdminSortableListingRequest):
    sort_by: S3ConnectionAdminSortBy = "name"
    search_exact: bool = False


class S3ConnectionGroupDetail(ApiModel):
    id: int
    name: str
    avatar: Optional[UiGroupAvatar]


class S3ConnectionAdminItem(ApiModel):
    id: int
    name: str
    storage_endpoint_id: Optional[int]
    endpoint_url: str
    is_active: bool
    execution_status: Literal["ready", "remediation_required"]
    remediation_reason: Optional[str]
    rgw_user_uid: Optional[str]
    rgw_tenant: Optional[str]
    rgw_account_id: Optional[str]
    provider_hint: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool
    allow_activity_history: Optional[bool]
    capabilities: dict[str, Any]
    created_by_user_id: int
    created_by_email: Optional[str]
    created_by_full_name: Optional[str]
    created_by_avatar: Optional[UserAvatar]
    user_count: int
    user_details: list[UserAssociationDetail]
    group_details: list[S3ConnectionGroupDetail]
    tags: list[TagDefinitionSummary]
    last_used_at: Optional[datetime]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class S3ConnectionSummary(ApiModel):
    id: int
    name: str
    created_by_user_id: int
    is_active: bool
    execution_status: Literal["ready", "remediation_required"]


class S3ConnectionAdminCreate(S3ConnectionCreationPayload):
    pass


class S3ConnectionAdminUpdate(CanonicalS3ConnectionEndpointPayload):
    endpoint_conflict_scope = "S3 connection"

    name: Optional[str] = None
    group_ids: Optional[list[int]] = None
    user_ids: Optional[list[int]] = None
    remediation_action: Optional[Literal["activate_manager"]] = None
    provider_hint: Optional[str] = None
    is_active: Optional[bool] = None
    rgw_user_uid: Optional[str] = None
    rgw_tenant: Optional[str] = None
    rgw_account_id: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    allow_activity_history: Optional[bool] = None
    tags: OptionalTagDefinitionList = None
    credentials: Optional[S3ConnectionCredentialsUpdate] = None

    @model_validator(mode="after")
    def reject_non_nullable_nulls(self) -> Self:
        reject_explicit_null_fields(
            self,
            (
                "name",
                "group_ids",
                "user_ids",
                "remediation_action",
                "is_active",
                "endpoint_url",
                "force_path_style",
                "verify_tls",
                "tags",
                "credentials",
            ),
        )
        return self


class PaginatedS3ConnectionsResponse(PaginatedResponse):
    items: list[S3ConnectionAdminItem]
