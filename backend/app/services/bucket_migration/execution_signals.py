# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable


class WorkerLeaseLostError(RuntimeError):
    """Raised when a worker loses ownership of a migration lease."""


class MigrationControlRequested(RuntimeError):
    """Raised when a long-running scan must stop for pause/cancel."""

    def __init__(self, state: str) -> None:
        super().__init__(state)
        self.state = state


def check_control_state(
    control_check: Callable[[], str],
    *,
    lost_lease_message: str,
) -> str:
    state = control_check()
    if state == "lost_lease":
        raise WorkerLeaseLostError(lost_lease_message)
    return state
