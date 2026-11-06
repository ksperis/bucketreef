# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Durable state helpers for managed private-access sagas."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.db import ManagedPrivateAccess, User
from app.services.managed_private_access_errors import ManagedPrivateAccessConflict
from app.services.managed_private_access_sources import ManagedPrivateAccessSource
from app.utils.time import utcnow


class ManagedPrivateAccessStateService:
    """Persist saga checkpoints and structured IAM cleanup state."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def claim(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccess:
        row = ManagedPrivateAccess(
            owner_user_id=user.id,
            source_context_type=source.kind,
            source_context_id=source.identifier,
            remote_principal_type=source.remote_principal_type,
            remote_principal_identifier=source.remote_principal_identifier,
            iam_username=source.iam_username,
            state="provisioning",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        try:
            commit_or_rollback(self.db)
        except IntegrityError as exc:
            raise ManagedPrivateAccessConflict(
                "A managed private access operation already exists for this execution context"
            ) from exc
        self.db.refresh(row)
        return row

    def checkpoint(self, provisioning: ManagedPrivateAccess) -> None:
        provisioning.updated_at = utcnow()
        commit_or_rollback(self.db)
        self.db.refresh(provisioning)

    def mark_failed(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        provisioning.state = "failed"
        provisioning.cleanup_error = error
        provisioning.updated_at = utcnow()
        commit_or_rollback(self.db)

    def mark_deleting(self, provisioning: ManagedPrivateAccess) -> None:
        provisioning.state = "deleting"
        provisioning.updated_at = utcnow()
        commit_or_rollback(self.db)

    def mark_cleanup_pending(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        provisioning.state = "cleanup_pending"
        provisioning.cleanup_error = error
        provisioning.updated_at = utcnow()
        commit_or_rollback(self.db)

    def append_list_value(
        self,
        provisioning: ManagedPrivateAccess,
        field_name: str,
        value: str,
    ) -> None:
        values = list(getattr(provisioning, field_name))
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
            for item in getattr(provisioning, field_name)
            if item != value
        ]
        setattr(provisioning, field_name, values)
