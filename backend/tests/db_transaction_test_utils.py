# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import event
from sqlalchemy.orm import Session


@contextmanager
def fail_next_transaction_commit(db: Session) -> Iterator[None]:
    """Fail the next real transaction commit on the session's engine."""

    bind = db.get_bind()

    def fail_commit(_connection) -> None:
        raise RuntimeError("commit failed")

    event.listen(bind, "commit", fail_commit, once=True)
    try:
        yield
    finally:
        event.remove(bind, "commit", fail_commit)
