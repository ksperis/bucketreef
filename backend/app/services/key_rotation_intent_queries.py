# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Queries for durable key-rotation intent state."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import KeyRotationIntent


def pending_rotation(
    db: Session,
    endpoint_id: int,
    key_type: str,
    target_id: int,
) -> KeyRotationIntent | None:
    return db.scalar(
        select(KeyRotationIntent).where(
            KeyRotationIntent.endpoint_id == endpoint_id,
            KeyRotationIntent.key_type == key_type,
            KeyRotationIntent.target_id == target_id,
        )
    )
