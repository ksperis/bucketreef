# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Durable state helpers for managed private-access sagas."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import ManagedPrivateAccess
from app.utils.time import utcnow


class ManagedPrivateAccessStateService:
    """Persist saga checkpoints and structured IAM cleanup state."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def checkpoint(self, provisioning: ManagedPrivateAccess) -> None:
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.db.refresh(provisioning)

    def mark_failed(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        provisioning.state = "failed"
        provisioning.cleanup_error = error
        provisioning.updated_at = utcnow()
        self.db.commit()

    @staticmethod
    def string_list(value: object) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("Managed private access IAM state must be a JSON list")
        if any(not isinstance(item, str) or not item for item in value):
            raise ValueError("Managed private access IAM state must contain non-empty strings")
        return value

    def append_list_value(
        self,
        provisioning: ManagedPrivateAccess,
        field_name: str,
        value: str,
    ) -> None:
        values = list(self.string_list(getattr(provisioning, field_name)))
        if value not in values:
            values.append(value)
        setattr(provisioning, field_name, values)

    def remove_list_value(
        self,
        provisioning: ManagedPrivateAccess,
        field_name: str,
        value: str,
    ) -> None:
        values = [
            item
            for item in self.string_list(getattr(provisioning, field_name))
            if item != value
        ]
        setattr(provisioning, field_name, values)
