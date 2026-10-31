# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable


def invoke_cancel_check(cancel_check: Callable[[], None] | None) -> None:
    if cancel_check is not None:
        cancel_check()
