# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Protocol, TypeVar

from sqlalchemy.engine import Connection, Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.database import is_sqlite_busy_error


_T = TypeVar("_T")
SQLITE_BUSY_RETRY_DELAYS_SECONDS = (0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0)


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


def _has_pending_changes(db: Session) -> bool:
    if db.new or db.deleted:
        return True
    if any(db.is_modified(row, include_collections=True) for row in db.dirty):
        return True

    # A flush clears Session.new/dirty while the surrounding transaction is
    # still uncommitted. SQLAlchemy's root SessionTransaction keeps rollback
    # snapshots for those flushed ORM changes until that transaction ends.
    # Checking them here prevents the SQLite isolation helper from silently
    # rolling back already-flushed business state before opening its writer.
    transaction = db.get_transaction()
    if transaction is None:
        return False
    return any(
        bool(getattr(transaction, attribute, None))
        for attribute in ("_new", "_dirty", "_deleted", "_key_switches")
    )


def acquire_sqlite_write_transaction(
    db: Session,
    operation: Callable[[Session], _T],
    *,
    retry_delays: tuple[float, ...] = SQLITE_BUSY_RETRY_DELAYS_SECONDS,
) -> _T | None:
    """Acquire SQLite write intent in the caller transaction before external I/O.

    PostgreSQL and other backends are left completely untouched. SQLite ends a
    stale read-only request transaction, then runs a caller-provided local
    write such as a no-op UPDATE under SQLITE_BUSY retry. A successful write
    transaction deliberately remains open so later non-replayable external
    side effects and their local database changes can share one transaction.

    The callback must only acquire database write intent. It must not commit,
    roll back, or perform external side effects. Callers remain responsible
    for committing or rolling back the transaction after their workflow.
    """

    if db.get_bind().dialect.name != "sqlite":
        return None

    if _has_pending_changes(db):
        raise RuntimeError(
            "SQLite write-intent acquisition requires a clean caller session"
        )

    # Request-scoped sessions commonly hold a read snapshot from authentication
    # or validation. End it before trying to become the writer.
    db.rollback()
    try:
        return run_db_unit_with_sqlite_retry(
            db,
            lambda: operation(db),
            retry_delays=retry_delays,
        )
    except BaseException:
        db.rollback()
        raise


def _fresh_session_bind(db: Session) -> Engine:
    bind = db.get_bind()
    if isinstance(bind, Engine):
        return bind
    if isinstance(bind, Connection):
        return bind.engine
    raise RuntimeError("Replayable SQLite units require an Engine-backed SQLAlchemy session")


def run_replayable_db_unit(
    db: Session,
    operation: Callable[[Session], _T],
    *,
    retry_delays: tuple[float, ...] = SQLITE_BUSY_RETRY_DELAYS_SECONDS,
) -> _T:
    """Persist one DB-only unit with provider-specific transaction semantics.

    PostgreSQL and other non-SQLite backends keep using the caller's Session
    and execute exactly once, preserving existing locking and transaction
    behavior. SQLite first ends any read-only request transaction, then owns a
    fresh Session for every attempt so SQLITE_BUSY, including
    SQLITE_BUSY_SNAPSHOT, can replay the complete local unit from a new
    snapshot.

    The callback must contain database work only. External side effects must
    happen before or after this helper because SQLite may replay the callback.
    """

    if db.get_bind().dialect.name != "sqlite":
        try:
            result = operation(db)
            db.commit()
            return result
        except BaseException:
            db.rollback()
            raise

    if _has_pending_changes(db):
        raise RuntimeError(
            "Replayable SQLite units require a clean caller session before opening "
            "an isolated write transaction"
        )

    # Request-scoped sessions commonly contain an authentication or lookup
    # read transaction. End that snapshot before opening the isolated writer.
    db.rollback()
    bind = _fresh_session_bind(db)
    delays = iter(retry_delays)

    while True:
        try:
            with Session(bind=bind, autoflush=False, expire_on_commit=False) as attempt_db:
                with attempt_db.begin():
                    return operation(attempt_db)
        except OperationalError as exc:
            if not is_sqlite_busy_error(exc):
                raise
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
