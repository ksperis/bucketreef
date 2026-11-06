# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import TypeVar

from pydantic import BaseModel, ValidationError


_ModelT = TypeVar("_ModelT", bound=BaseModel)


class ListingFilterQueryError(ValueError):
    """Raised when an advanced listing filter cannot be parsed or validated."""


def parse_filter_query(
    raw: str | None,
    *,
    query_cls: type[_ModelT],
) -> _ModelT | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ListingFilterQueryError("Invalid advanced_filter JSON") from exc
    if not isinstance(parsed, dict):
        raise ListingFilterQueryError("advanced_filter must be a JSON object")
    try:
        return query_cls.model_validate(parsed)
    except ValidationError as exc:
        raise ListingFilterQueryError(str(exc)) from exc
