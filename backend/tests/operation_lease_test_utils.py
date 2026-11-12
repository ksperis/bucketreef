# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import BackendOperationLease
from app.utils.time import utcnow


def active_operation_lease_owner(db: Session, operation_name: str) -> str | None:
    owner = db.scalar(
        select(BackendOperationLease.lease_owner)
        .where(
            BackendOperationLease.operation_name == operation_name,
            BackendOperationLease.lease_until > utcnow(),
        )
        .limit(1)
    )
    return str(owner) if owner else None
