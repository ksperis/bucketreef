# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from pydantic import Field, field_validator

from app.models.base import ApiModel


class AccessKeyMetadataInput(ApiModel):
    name: Optional[str] = Field(default=None, max_length=128)
    notes: Optional[str] = Field(default=None, max_length=2000)

    @field_validator("name", "notes", mode="before")
    @classmethod
    def normalize_optional_text(cls, value: object) -> object:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class AccessKeyMetadata(AccessKeyMetadataInput):
    pass
