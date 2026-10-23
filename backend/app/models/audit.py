# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from app.models.base import ApiModel

AuditStatus = Literal["success", "failure", "partial"]


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
