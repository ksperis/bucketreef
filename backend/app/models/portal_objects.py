# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Portal storage-object API contracts."""

from datetime import datetime
from typing import Literal, Optional

from app.models.base import ApiModel


PortalStorageObjectPreviewType = Literal["text", "image", "unavailable"]


class PortalStorageObjectDeleteResponse(ApiModel):
    key: str
    message: str


class PortalStorageObjectDetail(ApiModel):
    key: str
    name: str
    size: Optional[int]
    last_modified: Optional[datetime]
    content_type: Optional[str]
    storage_class: Optional[str]
    encryption: Optional[str]
    preview_type: PortalStorageObjectPreviewType
    preview_text: Optional[str]
    preview_unavailable_reason: Optional[str]
