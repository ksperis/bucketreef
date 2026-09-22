# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

from app.models.base import ApiModel


class S3Object(ApiModel):
    key: str
    size: int
    last_modified: datetime | None = None
    storage_class: str | None = None


class ListObjectsResponse(ApiModel):
    prefix: str
    objects: list[S3Object]
    prefixes: list[str]
    is_truncated: bool = False
    next_continuation_token: str | None = None
