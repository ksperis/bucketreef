# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.models.pagination import PaginationRequest


class CephAdminIdentityListingRequest(PaginationRequest):
    search: str | None = None
    advanced_filter: str | None = None
    sort_dir: Literal["asc", "desc"] = "asc"
    include: list[str] = Field(default_factory=list)


class CephAdminAccountListingRequest(CephAdminIdentityListingRequest):
    sort_by: str = "account_id"


class CephAdminUserListingRequest(CephAdminIdentityListingRequest):
    sort_by: str = "uid"
