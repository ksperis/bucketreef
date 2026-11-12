# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from pydantic import Field

from app.models.audit import AuditActivityFields, AuditStatus
from app.models.base import ApiModel


class ManagerActivityListingRequest(ApiModel):
    limit: int = Field(default=5, ge=1, le=20)
    cursor: Optional[int] = Field(default=None, ge=1)
    search: Optional[str] = Field(default=None, max_length=200)
    status: Optional[AuditStatus] = None


class ManagerActivityEntry(AuditActivityFields):
    pass
