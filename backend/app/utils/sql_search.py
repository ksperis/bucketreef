# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import func


def text_search_predicate(column, value: str, *, exact: bool):
    """Build a case-insensitive literal text search predicate."""
    normalized = value.strip()
    if exact:
        return func.lower(func.trim(func.coalesce(column, ""))) == normalized.lower()

    escaped = normalized.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike(f"%{escaped}%", escape="\\")
