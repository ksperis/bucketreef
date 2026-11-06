# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal, Optional

from pydantic import Field

from app.models.base import ApiModel


AdminManagedSortDir = Literal["asc", "desc"]


class AdminManagedEntityListingRequest(ApiModel):
    """Shared query contract for paginated Admin-managed storage entities."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=200)
    search: Optional[str] = None
    search_exact: bool = False
    sort_by: str = "name"
    sort_dir: AdminManagedSortDir = "asc"
    include_quota: bool = Field(
        default=False,
        description="Include RGW quota information (slower).",
    )
