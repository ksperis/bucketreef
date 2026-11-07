# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from pydantic import Field

from app.core.domain_enums import SortDirection
from app.models.pagination import PaginationRequest


class CephAdminIdentityListingRequest(PaginationRequest):
    search: str | None = None
    advanced_filter: str | None = None
    sort_dir: SortDirection = "asc"
    include: list[str] = Field(default_factory=list)


class CephAdminAccountListingRequest(CephAdminIdentityListingRequest):
    sort_by: str = "account_id"


class CephAdminUserListingRequest(CephAdminIdentityListingRequest):
    sort_by: str = "uid"
