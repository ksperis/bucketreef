# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Protocol


class _CommitRollback(Protocol):
    def commit(self) -> None: ...

    def rollback(self) -> None: ...


def commit_or_rollback(db: _CommitRollback) -> None:
    """Commit the current unit of work and restore its transaction on failure."""

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
