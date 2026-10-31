# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.sql.elements import ColumnElement


def name_order_by(
    model: Any,
    *,
    descending: bool = False,
) -> tuple[ColumnElement[Any], ColumnElement[Any], ColumnElement[Any]]:
    direction = "desc" if descending else "asc"
    return (
        getattr(func.lower(model.name), direction)(),
        getattr(model.name, direction)(),
        getattr(model.id, direction)(),
    )
