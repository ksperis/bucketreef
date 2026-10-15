# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from app.models.base import ApiModel


class ManagerActivityEntry(ApiModel):
    id: int
    created_at: datetime
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    context_kind: Optional[str] = None
    context_id: Optional[str] = None
    context_name: Optional[str] = None
    status: Literal["success", "failure", "partial"]
    user_email: str
