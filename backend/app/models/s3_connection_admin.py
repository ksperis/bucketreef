# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Admin models for S3 connections."""

from __future__ import annotations

from typing import Literal, Optional, Self

from pydantic import model_validator

from app.models.admin_listing import AdminSortableListingRequest
from app.models.base import ApiModel, reject_explicit_null_fields
from app.models.pagination import PaginatedResponse
from app.models.s3_connection import (
    S3ConnectionCreationPayload,
    S3ConnectionCredentialsUpdate,
    S3ConnectionUpdateFields,
    S3ConnectionViewFields,
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
S3ConnectionExecutionStatus = Literal["ready", "remediation_required"]


class S3ConnectionAdminListingRequest(AdminSortableListingRequest):
    sort_by: S3ConnectionAdminSortBy = "name"
    search_exact: bool = False


class S3ConnectionGroupDetail(ApiModel):
    id: int
    name: str
    avatar: Optional[UiGroupAvatar]


class S3ConnectionAdminItem(S3ConnectionViewFields):
    execution_status: S3ConnectionExecutionStatus
    remediation_reason: Optional[str]
    allow_activity_history: Optional[bool]
    created_by_email: Optional[str]
    created_by_full_name: Optional[str]
    created_by_avatar: Optional[UserAvatar]
    user_count: int
    user_details: list[UserAssociationDetail]
    group_details: list[S3ConnectionGroupDetail]


class S3ConnectionSummary(ApiModel):
    id: int
    name: str
    created_by_user_id: int
    is_active: bool
    execution_status: S3ConnectionExecutionStatus


class S3ConnectionAdminCreate(S3ConnectionCreationPayload):
    pass


class S3ConnectionAdminUpdate(S3ConnectionUpdateFields):
    group_ids: Optional[list[int]] = None
    user_ids: Optional[list[int]] = None
    remediation_action: Optional[Literal["activate_manager"]] = None
    allow_activity_history: Optional[bool] = None
    credentials: Optional[S3ConnectionCredentialsUpdate] = None

    @model_validator(mode="after")
    def reject_admin_nulls(self) -> Self:
        reject_explicit_null_fields(
            self,
            (
                "group_ids",
                "user_ids",
                "remediation_action",
                "credentials",
            ),
        )
        return self


class PaginatedS3ConnectionsResponse(PaginatedResponse):
    items: list[S3ConnectionAdminItem]
