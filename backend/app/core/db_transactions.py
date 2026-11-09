# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Protocol, TypeVar

from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.database import is_sqlite_busy_error


_T = TypeVar("_T")
SQLITE_BUSY_RETRY_DELAYS_SECONDS = (0.025, 0.05, 0.1, 0.25, 0.5)


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


def run_db_unit_with_sqlite_retry(
    db: Session,
    operation: Callable[[], _T],
    *,
    retry_delays: tuple[float, ...] = SQLITE_BUSY_RETRY_DELAYS_SECONDS,
) -> _T:
    """Run one replayable DB-only unit and retry SQLite BUSY failures.

    PostgreSQL and other backends execute the operation exactly once. SQLite
    retries only the SQLITE_BUSY family, including extended errors such as
    SQLITE_BUSY_SNAPSHOT. The callback must not perform external side effects
    because the entire unit can be replayed after rollback.
    """

    if db.get_bind().dialect.name != "sqlite":
        return operation()

    delays = iter(retry_delays)
    while True:
        try:
            return operation()
        except OperationalError as exc:
            if not is_sqlite_busy_error(exc):
                raise
            db.rollback()
            try:
                delay = next(delays)
            except StopIteration:
                raise exc
            time.sleep(delay)


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
