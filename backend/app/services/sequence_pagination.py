# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Sequence
from typing import TypeVar

from app.services.pagination_window import page_window


_T = TypeVar("_T")


def paginate_sequence(
    items: Sequence[_T],
    *,
    page: int,
    page_size: int,
) -> tuple[list[_T], int, bool]:
    total = len(items)
    window = page_window(total=total, page=page, page_size=page_size)
    return list(items[window.offset : window.end]), total, window.has_next
