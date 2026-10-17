# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import TypeVar

from fastapi import HTTPException, status
from pydantic import BaseModel, ValidationError

from app.utils.http_errors import raise_http_exception_from_exception


_ModelT = TypeVar("_ModelT", bound=BaseModel)


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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid advanced_filter JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="advanced_filter must be a JSON object")
    try:
        return query_cls.model_validate(parsed)
    except ValidationError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
