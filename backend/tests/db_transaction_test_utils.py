# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import sqlite3

from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session


@contextmanager
def fail_next_transaction_commit(
    db: Session,
    *,
    occurrence: int = 1,
) -> Iterator[None]:
    """Fail one selected real transaction commit on the session's engine."""

    bind = db.get_bind()
    commit_count = 0

    def fail_commit(_connection) -> None:
        nonlocal commit_count
        commit_count += 1
        if commit_count == occurrence:
            raise RuntimeError("commit failed")

    event.listen(bind, "commit", fail_commit)
    try:
        yield
    finally:
        event.remove(bind, "commit", fail_commit)


@contextmanager
def fail_next_sqlite_statement_with_busy_snapshot(
    db: Session,
    statement_prefix: str,
    *,
    occurrence: int = 1,
) -> Iterator[list[str]]:
    """Fail one selected matching SQL statement with SQLITE_BUSY_SNAPSHOT."""

    bind = db.get_bind()
    matching_statements: list[str] = []

    def fail_once(_connection, _cursor, statement, _parameters, _context, _executemany) -> None:
        if not statement.startswith(statement_prefix):
            return
        matching_statements.append(statement)
        if len(matching_statements) == occurrence:
            original = sqlite3.OperationalError("database is locked")
            original.sqlite_errorcode = sqlite3.SQLITE_BUSY_SNAPSHOT
            raise OperationalError(statement, (), original)

    event.listen(bind, "before_cursor_execute", fail_once)
    try:
        yield matching_statements
    finally:
        event.remove(bind, "before_cursor_execute", fail_once)
