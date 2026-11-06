# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import Field

from app.models.pagination import PaginationRequest


AdminSortDir = Literal["asc", "desc"]


class AdminPaginatedListingRequest(PaginationRequest):
    """Shared pagination and search controls for Admin listings."""

    search: Optional[str] = None


class AdminOptionListingRequest(AdminPaginatedListingRequest):
    """Shared pagination and search controls for compact Admin option lists."""

    page_size: int = Field(default=25, ge=1, le=100)
    search: Optional[str] = Field(default=None, max_length=200)


class AdminSortableListingRequest(AdminPaginatedListingRequest):
    """Shared pagination and sorting controls for Admin list routes."""

    sort_by: str = "name"
    sort_dir: AdminSortDir = "asc"


class AdminManagedEntityListingRequest(AdminSortableListingRequest):
    """Shared controls for Admin-managed storage entity listings."""

    search_exact: bool = False
    include_quota: bool = Field(
        default=False,
        description="Include RGW quota information (slower).",
    )
