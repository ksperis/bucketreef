# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.db import BucketMigration, User
from app.services.effective_access_service import EffectiveAccessService
from app.utils.time import utcnow
from ._shared import _json_dumps, _WorkerLeaseLostError


class BucketMigrationPersistenceMixin:
    def _bind_workflow_lease(self, migration_id: int, worker_id: str | None) -> None:
        self._workflow_migration_id = migration_id
        self._workflow_worker_id = worker_id
        self._assert_workflow_lease()

    def _assert_workflow_lease(self) -> None:
        worker_id = getattr(self, "_workflow_worker_id", None)
        if not worker_id:
            return
        # Read scalar columns: the ORM identity map may still contain a former lease.
        row = self.db.query(BucketMigration.worker_lease_owner, BucketMigration.worker_lease_until).filter(
            BucketMigration.id == self._workflow_migration_id,
        ).one()
        if row.worker_lease_owner != worker_id or not row.worker_lease_until or row.worker_lease_until < utcnow():
            raise _WorkerLeaseLostError("Migration worker lease lost")

    def _commit(self) -> None:
        self.db.commit()

    def _json_dumps_safe(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        return _json_dumps(value)

    def _is_context_authorized(self, context_id: str) -> bool:
        if self._authorized_context_ids is None:
            return True
        return str(context_id or "").strip() in self._authorized_context_ids

    def _assert_context_authorized_for_mutation(self, context_id: str) -> None:
        if self._is_context_authorized(context_id):
            return
        raise PermissionError("Not authorized for this context")

    def _creator_allowed_context_ids(self, migration: BucketMigration) -> set[str]:
        user_id = migration.created_by_user_id
        if migration.maintenance_status in {"queued", "running"}:
            user_id = migration.maintenance_requested_by_user_id or user_id
        return self._actor_allowed_context_ids(user_id)

    def _actor_allowed_context_ids(self, user_id: int | None) -> set[str]:
        user = self.db.query(User).filter(
            User.id == user_id,
            User.is_active.is_(True),
        ).first()
        if user is None:
            return set()
        return EffectiveAccessService(self.db).build_bucket_migration_scope(user).allowed_context_ids

    def _assert_migration_creator_access(self, migration: BucketMigration) -> None:
        allowed = self._creator_allowed_context_ids(migration)
        required = {str(migration.source_context_id), str(migration.target_context_id)}
        if required <= allowed:
            return
        missing = sorted(required - allowed)
        # A preparation or cleanup failure must not erase the transfer outcome.
        if migration.status == "draft" or migration.maintenance_status in {"queued", "running"}:
            raise PermissionError("Migration creator access has been revoked for context(s): " + ", ".join(missing))
        migration.status = "failed"
        migration.error_message = "Migration access revoked for context(s): " + ", ".join(missing)
        migration.finished_at = utcnow()
        migration.updated_at = utcnow()
        self._add_event(
            migration,
            level="error",
            message="Migration stopped because creator access was revoked.",
            metadata={"revoked_context_ids": missing},
        )
        self._commit()
        raise PermissionError("Migration creator access has been revoked")

    def _is_account_context_id(self, context_id: str) -> bool:
        return str(context_id or "").strip().isdigit()

    def _assert_cross_account_admin_contexts(self, source_context_id: str, target_context_id: str) -> None:
        if self._admin_account_context_ids is None:
            return

        source_value = str(source_context_id or "").strip()
        target_value = str(target_context_id or "").strip()
        if source_value == target_value:
            return
        if not self._is_account_context_id(source_value) or not self._is_account_context_id(target_value):
            return
        if source_value in self._admin_account_context_ids and target_value in self._admin_account_context_ids:
            return
        raise PermissionError(
            "Cross-account migrations require admin access on both source and target account contexts"
        )
