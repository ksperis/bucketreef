# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Durable state helpers for managed private-access sagas."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
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
        now = utcnow()

        def claim_once(write_db: Session) -> int:
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
            write_db.add(row)
            write_db.flush()
            return int(row.id)

        try:
            row_id = run_replayable_db_unit(self.db, claim_once)
        except IntegrityError as exc:
            raise ManagedPrivateAccessConflict(
                "A managed private access operation already exists for this execution context"
            ) from exc
        row = self.db.get(ManagedPrivateAccess, row_id)
        if row is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("Managed private access claim could not be reloaded")
        return row

    def checkpoint(
        self,
        provisioning: ManagedPrivateAccess,
        **changes: object,
    ) -> None:
        row_id = int(provisioning.id)
        invalid_fields = set(changes) - set(self._CHECKPOINT_FIELDS)
        if invalid_fields:
            raise ValueError(
                "Unsupported managed private access checkpoint fields: "
                + ", ".join(sorted(invalid_fields))
            )
        snapshot: dict[str, object] = {}
        for field_name in self._CHECKPOINT_FIELDS:
            value = changes.get(field_name, getattr(provisioning, field_name))
            snapshot[field_name] = list(value) if isinstance(value, list) else value
        updated_at = utcnow()

        def persist_once(write_db: Session) -> None:
            row = write_db.get(ManagedPrivateAccess, row_id)
            if row is None:  # pragma: no cover - defensive consistency check
                raise RuntimeError("Managed private access checkpoint could not be reloaded")
            for field_name, value in snapshot.items():
                setattr(row, field_name, value)
            row.updated_at = updated_at

        run_replayable_db_unit(self.db, persist_once)
        self.db.refresh(provisioning)

    def mark_failed(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        self.checkpoint(provisioning, state="failed", cleanup_error=error)

    def mark_deleting(self, provisioning: ManagedPrivateAccess) -> None:
        self.checkpoint(provisioning, state="deleting")

    def mark_cleanup_pending(self, provisioning: ManagedPrivateAccess, error: str) -> None:
        self.checkpoint(provisioning, state="cleanup_pending", cleanup_error=error)

    def append_list_value(
        self,
        provisioning: ManagedPrivateAccess,
        field_name: str,
        value: str,
    ) -> None:
        values = list(getattr(provisioning, field_name))
        if value not in values:
            values.append(value)
        self.checkpoint(provisioning, **{field_name: values})

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
        self.checkpoint(provisioning, **{field_name: values})
