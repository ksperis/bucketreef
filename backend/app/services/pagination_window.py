# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PageWindow:
    offset: int
    end: int
    has_next: bool


def page_window(*, total: int, page: int, page_size: int) -> PageWindow:
    offset = max(page - 1, 0) * page_size
    end = offset + page_size
    return PageWindow(offset=offset, end=end, has_next=end < total)
