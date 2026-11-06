# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import Field

from app.models.base import ApiModel

AuditStatus = Literal["success", "failure", "partial"]


class AuditLogListingRequest(ApiModel):
    limit: int = Field(default=200, ge=1, le=500)
    cursor: Optional[int] = Field(
        default=None,
        description="Use the id from the last entry of the previous page",
    )
    role: Optional[str] = Field(default=None, description="Filter by user role")
    scope: Optional[str] = Field(default=None, description="Filter by admin/manager scope")
    context_kind: Optional[str] = Field(
        default=None,
        description="Filter by execution-context kind",
    )
    context_id: Optional[str] = Field(
        default=None,
        description="Filter by execution-context id",
    )
    search: Optional[str] = Field(
        default=None,
        description="Search by actor, action, or target",
    )


class AuditLogEntry(ApiModel):
    id: int
    created_at: datetime
    user_email: str
    user_role: str
    scope: str
    action: str
    entity_type: Optional[str]
    entity_id: Optional[str]
    context_kind: Optional[str]
    context_id: Optional[str]
    context_name: Optional[str]
    status: AuditStatus
    message: Optional[str]
    metadata: Optional[dict[str, Any]]


class AuditLogListResponse(ApiModel):
    logs: list[AuditLogEntry]
    next_cursor: Optional[int]
