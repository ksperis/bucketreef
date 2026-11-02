# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from collections.abc import Iterable

from pydantic import BaseModel, ConfigDict


def reject_explicit_null_fields(model: BaseModel, field_names: Iterable[str]) -> None:
    """Reject ``null`` only when a PATCH-like field was explicitly supplied."""
    for field_name in field_names:
        if field_name in model.model_fields_set and getattr(model, field_name) is None:
            raise ValueError(f"{field_name} cannot be null")


class ApiModel(BaseModel):
    """Canonical base for strict backend API data-transfer objects."""

    model_config = ConfigDict(extra="forbid")
