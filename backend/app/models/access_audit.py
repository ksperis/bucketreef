# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Read-only contracts for the Admin effective-access audit."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel
from app.models.pagination import PaginatedResponse
from app.models.user import UiRole

AccessAuditScope = Literal["platform", "rgw_account", "rgw_user", "s3_connection"]
AccessAuditSourceKind = Literal["direct", "group", "platform"]
AccessAuditSortBy = Literal["user", "scope", "target"]
AccessAuditSortDir = Literal["asc", "desc"]
AccessAuditRightCode = Literal[
    "ceph_admin",
    "storage_ops",
    "manager_bucket_compare",
    "manager_bucket_integrity_check",
    "manager_bucket_migration",
    "manager_feature_rules",
    "manager_bucket_purge",
    "private_connection_create",
    "managed_private_connection_provision",
    "browser_advanced_features",
    "account_administrator",
    "portal_manager",
    "portal_user",
    "manager_browser_data_access",
    "rgw_user_access",
    "shared_connection_access",
]


class AccessAuditFilters(ApiModel):
    search: Optional[str] = None
    scope: Optional[AccessAuditScope] = None
    right: Optional[AccessAuditRightCode] = None
    source: Optional[AccessAuditSourceKind] = None
    user_id: Optional[int] = Field(default=None, ge=1)
    group_id: Optional[int] = Field(default=None, ge=1)
    target_id: Optional[int] = Field(default=None, ge=1)
    sort_by: AccessAuditSortBy = "user"
    sort_dir: AccessAuditSortDir = "asc"


class AccessAuditListingRequest(AccessAuditFilters):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=200)


class AccessAuditGrantSource(ApiModel):
    kind: AccessAuditSourceKind
    group_id: Optional[int]
    group_name: Optional[str]


class AccessAuditRight(ApiModel):
    code: AccessAuditRightCode
    sources: list[AccessAuditGrantSource]


class AccessAuditPrincipal(ApiModel):
    id: int
    email: str
    full_name: Optional[str]
    role: UiRole
    is_active: bool


class AccessAuditTarget(ApiModel):
    id: Optional[int]
    name: str
    identifier: Optional[str]


class AccessAuditRow(ApiModel):
    key: str
    principal: AccessAuditPrincipal
    scope: AccessAuditScope
    target: AccessAuditTarget
    rights: list[AccessAuditRight]


class PaginatedAccessAuditResponse(PaginatedResponse):
    items: list[AccessAuditRow]
