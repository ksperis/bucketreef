# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.core.domain_enums import SortDirection
from app.models.pagination import PaginationRequest


class CephAdminIdentityListingRequest(PaginationRequest):
    search: str | None = None
    advanced_filter: str | None = None
    sort_dir: SortDirection = "asc"
    include: list[str] = Field(default_factory=list)


CephAdminAccountSortBy = Literal[
    "account_id",
    "account_name",
    "email",
    "max_users",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
    "bucket_count",
    "user_count",
]
CephAdminUserSortBy = Literal[
    "uid",
    "tenant",
    "account_name",
    "full_name",
    "email",
    "suspended",
    "max_buckets",
    "quota_max_size_bytes",
    "quota_max_objects",
]


class CephAdminAccountListingRequest(CephAdminIdentityListingRequest):
    sort_by: CephAdminAccountSortBy = "account_id"


class CephAdminUserListingRequest(CephAdminIdentityListingRequest):
    sort_by: CephAdminUserSortBy = "uid"
