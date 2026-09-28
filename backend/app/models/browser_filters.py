# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import datetime, timezone

from pydantic import AwareDatetime, Field, field_validator, model_validator

from app.models.base import ApiModel


class BrowserFileFilters(ApiModel):
    min_size: int | None = Field(default=None, ge=0)
    max_size: int | None = Field(default=None, ge=0)
    modified_after: AwareDatetime | None = None
    modified_before: AwareDatetime | None = None
    extensions: tuple[str, ...] = ()

    @field_validator("extensions")
    @classmethod
    def normalize_extensions(cls, values):
        result = tuple(sorted({value.strip().lstrip(".").casefold() for value in values if value.strip().lstrip(".")}))
        if len(result) > 30 or any(len(value) > 64 or "/" in value or "\\" in value for value in result):
            raise ValueError("Use at most 30 extensions, each up to 64 characters")
        return result

    @model_validator(mode="after")
    def validate_ranges(self):
        if self.min_size is not None and self.max_size is not None and self.min_size > self.max_size:
            raise ValueError("Minimum size exceeds maximum size")
        if self.modified_after and self.modified_before and self.modified_after > self.modified_before:
            raise ValueError("Start date is later than end date")
        return self

    @property
    def active(self):
        return any(value is not None for value in (self.min_size, self.max_size, self.modified_after, self.modified_before)) or bool(self.extensions)

    @property
    def signature(self):
        return (self.min_size, self.max_size, self.modified_after.isoformat() if self.modified_after else None,
                self.modified_before.isoformat() if self.modified_before else None, self.extensions)

    def matches(self, entry):
        size = int(entry.get("Size") or 0)
        if self.min_size is not None and size < self.min_size:
            return False
        if self.max_size is not None and size > self.max_size:
            return False
        if self.extensions and not str(entry.get("Key", "")).casefold().endswith(tuple("." + value for value in self.extensions)):
            return False
        if self.modified_after or self.modified_before:
            date = entry.get("LastModified")
            if not isinstance(date, datetime):
                return False
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            if self.modified_after and date < self.modified_after:
                return False
            if self.modified_before and date > self.modified_before:
                return False
        return True
