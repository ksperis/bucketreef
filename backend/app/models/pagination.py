# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from pydantic import Field

from app.models.base import ApiModel


class PaginationRequest(ApiModel):
    """Shared application pagination controls."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=25, ge=1, le=200)


class PaginatedResponse(ApiModel):
    items: list
    total: int
    page: int
    page_size: int
    has_next: bool
