# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Sequence
from typing import TypeVar


_T = TypeVar("_T")


def paginate_sequence(
    items: Sequence[_T],
    *,
    page: int,
    page_size: int,
) -> tuple[list[_T], int, bool]:
    total = len(items)
    start = max(page - 1, 0) * page_size
    end = start + page_size
    return list(items[start:end]), total, end < total
