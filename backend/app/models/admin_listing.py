# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel


AdminSortDir = Literal["asc", "desc"]


class AdminPaginatedListingRequest(ApiModel):
    """Shared query contract for paginated Admin listings."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=200)
    search: Optional[str] = None


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
