# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel


class AccessKeyMetadataInput(ApiModel):
    name: Optional[str] = Field(default=None, max_length=128)
    notes: Optional[str] = Field(default=None, max_length=2000)
    expires_at: Optional[datetime] = None

    @field_validator("name", "notes", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("expires_at")
    @classmethod
    def normalize_expiration(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return None
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("expires_at must include a timezone")
        return value.astimezone(timezone.utc)


class AccessKeyMetadata(AccessKeyMetadataInput):
    expiration_state: Optional[Literal["scheduled", "retrying", "enforced", "blocked"]] = None
    expiration_enforced_at: Optional[datetime] = None
    expiration_last_attempt_at: Optional[datetime] = None
    expiration_last_error: Optional[str] = None
