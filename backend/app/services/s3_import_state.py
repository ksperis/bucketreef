# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import secrets

from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.db import S3AccountImportIntent, S3UserImportIntent
from app.utils.time import utcnow


S3ImportIntent = S3AccountImportIntent | S3UserImportIntent


def new_s3_import_credentials() -> tuple[str, str]:
    return secrets.token_hex(10).upper(), secrets.token_urlsafe(32)


def checkpoint_s3_import_intent(
    db: Session,
    intent: S3ImportIntent,
    phase: str,
) -> None:
    intent_id = int(intent.id)
    intent_type = type(intent)
    updated_at = utcnow()

    def checkpoint_once(write_db: Session) -> None:
        current = write_db.get(intent_type, intent_id)
        if current is None:
            raise RuntimeError("Pending S3 import intent disappeared")
        current.phase = phase
        current.updated_at = updated_at

    run_replayable_db_unit(db, checkpoint_once)
    db.refresh(intent)
