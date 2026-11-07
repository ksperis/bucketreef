# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Protocol

from sqlalchemy.orm import Session


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


@contextmanager
def rollback_on_error(db: _CommitRollback) -> Iterator[None]:
    """Rollback a unit of work when any operation in the scope fails."""

    try:
        yield
    except Exception:
        db.rollback()
        raise


def rollback_safely(db: _CommitRollback) -> Exception | None:
    """Attempt a rollback without masking the exception that triggered compensation."""

    try:
        db.rollback()
    except Exception as exc:
        return exc
    return None


def add_and_flush_in_savepoint(db: Session, row: object) -> None:
    """Persist one ORM row inside a rollback-safe nested transaction."""

    with db.begin_nested():
        db.add(row)
        db.flush()
