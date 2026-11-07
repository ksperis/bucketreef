# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Sequence, TypeVar

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select

from app.services.pagination_window import page_window


_T = TypeVar("_T")


def paginate_scalars(
    db: Session,
    statement: Select[tuple[_T]],
    *,
    order_by: Sequence[Any],
    page: int,
    page_size: int,
    unique: bool = False,
) -> tuple[list[_T], int, bool]:
    total = int(
        db.scalar(
            select(func.count()).select_from(statement.order_by(None).subquery())
        )
        or 0
    )
    window = page_window(total=total, page=page, page_size=page_size)
    rows = db.scalars(
        statement.order_by(*order_by)
        .offset(window.offset)
        .limit(page_size)
    )
    if unique:
        rows = rows.unique()
    return rows.all(), total, window.has_next


def paginate_rows(
    db: Session,
    statement: Select[Any],
    *,
    page: int,
    page_size: int,
) -> tuple[list[Any], int, bool]:
    total = int(
        db.scalar(
            select(func.count()).select_from(statement.order_by(None).subquery())
        )
        or 0
    )
    window = page_window(total=total, page=page, page_size=page_size)
    rows = db.execute(statement.offset(window.offset).limit(page_size))
    return list(rows.all()), total, window.has_next
