# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import secrets
from datetime import datetime
from typing import Protocol

from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.utils.time import utcnow


class S3ImportIntent(Protocol):
    phase: str
    updated_at: datetime


def new_s3_import_credentials() -> tuple[str, str]:
    return secrets.token_hex(10).upper(), secrets.token_urlsafe(32)


def checkpoint_s3_import_intent(
    db: Session,
    intent: S3ImportIntent,
    phase: str,
) -> None:
    intent.phase = phase
    intent.updated_at = utcnow()
    commit_or_rollback(db)
    db.refresh(intent)
