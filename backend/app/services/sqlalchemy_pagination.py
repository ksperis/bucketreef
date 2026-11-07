# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Sequence, TypeVar

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select


_T = TypeVar("_T")


def paginate_scalars(
    db: Session,
    statement: Select[tuple[_T]],
    *,
    order_by: Sequence[Any],
    page: int,
    page_size: int,
    unique: bool = False,
) -> tuple[list[_T], int]:
    total = int(
        db.scalar(
            select(func.count()).select_from(statement.order_by(None).subquery())
        )
        or 0
    )
    offset = max(page - 1, 0) * page_size
    rows = db.scalars(
        statement.order_by(*order_by)
        .offset(offset)
        .limit(page_size)
    )
    if unique:
        rows = rows.unique()
    return rows.all(), total


def paginate_rows(
    db: Session,
    statement: Select[Any],
    *,
    page: int,
    page_size: int,
) -> tuple[list[Any], int]:
    total = int(
        db.scalar(
            select(func.count()).select_from(statement.order_by(None).subquery())
        )
        or 0
    )
    offset = max(page - 1, 0) * page_size
    rows = db.execute(statement.offset(offset).limit(page_size))
    return list(rows.all()), total
