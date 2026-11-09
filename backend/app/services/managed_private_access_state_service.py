# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Durable state helpers for managed private-access sagas."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback, run_db_unit_with_sqlite_retry
from app.db import ManagedPrivateAccess, User
from app.services.managed_private_access_errors import ManagedPrivateAccessConflict
from app.services.managed_private_access_sources import ManagedPrivateAccessSource
from app.utils.time import utcnow


class ManagedPrivateAccessStateService:
    """Persist saga checkpoints and structured IAM cleanup state."""

    _CHECKPOINT_FIELDS = (
        "state",
        "cleanup_error",
        "access_key_id",
        "s3_connection_id",
        "iam_groups",
        "iam_managed_policies",
        "iam_inline_policy_names",
        "created_remote_principal",
        "created_access_key",
    )

    def __init__(self, db: Session) -> None:
        self.db = db

    def claim(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccess:
        owner_user_id = int(user.id)

        def claim_once() -> int:
            now = utcnow()
            row = ManagedPrivateAccess(
                owner_user_id=owner_user_id,
                source_context_type=source.kind,
                source_context_id=source.identifier,
                remote_principal_type=source.remote_principal_type,
                remote_principal_identifier=source.remote_principal_identifier,
                iam_username=source.iam_username,
                state="provisioning",
                created_at=now,
                updated_at=now,
            )
            self.db.add(row)
            commit_or_rollback(self.db)
            return int(row.id)

        try:
            row_id = run_db_unit_with_sqlite_retry(self.db, claim_once)
        except IntegrityError as exc:
            raise ManagedPrivateAccessConflict(
                "A managed private access operation already exists for this execution context"
            ) from exc
        row = self.db.get(ManagedPrivateAccess, row_id)
        if row is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("Managed private access claim could not be reloaded")
        return row

    def checkpoint(self, provisioning: ManagedPrivateAccess) -> None:
        row_id = int(provisioning.id)
        snapshot = {
            field_name: getattr(provisioning, field_name)
            for field_name in self._CHECKPOINT_FIELDS
        }
        updated_at = utcnow()

        def persist_once() -> None:
            with self.db.no_autoflush:
                row = self.db.get(ManagedPrivateAccess, row_id)
            if row is None:  # pragma: no cover - defensive consistency check
                raise RuntimeError("Managed private access checkpoint could not be reloaded")
            for field_name, value in snapshot.items():
                setattr(row, field_name, value)
            row.updated_at = updated_at
            commit_or_rollback(self.db)

        run_db_unit_with_sqlite_retry(self.db, persist_once)
        self.db.refresh(provisioning)

    def mark_failed(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        provisioning.state = "failed"
        provisioning.cleanup_error = error
        self.checkpoint(provisioning)

    def mark_deleting(self, provisioning: ManagedPrivateAccess) -> None:
        provisioning.state = "deleting"
        self.checkpoint(provisioning)

    def mark_cleanup_pending(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        provisioning.state = "cleanup_pending"
        provisioning.cleanup_error = error
        self.checkpoint(provisioning)

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
