# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session


def commit_or_rollback(db: Session) -> None:
    """Commit the current unit of work and restore the session on failure."""

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
