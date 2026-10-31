# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator


def iter_exception_chain(exc: Exception) -> Iterator[Exception]:
    """Yield an exception followed by its explicit cause or visible context."""
    current: BaseException | None = exc
    seen: set[int] = set()
    while isinstance(current, Exception) and id(current) not in seen:
        seen.add(id(current))
        yield current
        if current.__cause__ is not None:
            current = current.__cause__
        elif current.__suppress_context__:
            current = None
        else:
            current = current.__context__
