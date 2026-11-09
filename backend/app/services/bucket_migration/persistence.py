# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable, Optional

from sqlalchemy import select

from app.core.db_transactions import commit_or_rollback, run_db_unit_with_sqlite_retry
from app.db import BucketMigration, BucketMigrationItem, User
from app.services.effective_access_service import EffectiveAccessService
from app.utils.normalize import normalize_optional_string
from app.utils.time import utcnow
from .execution_signals import WorkerLeaseLostError


class BucketMigrationPersistenceMixin:
    def _bind_workflow_lease(self, migration_id: int, worker_id: str | None) -> None:
        self._workflow_migration_id = migration_id
        self._workflow_worker_id = worker_id
        self._assert_workflow_lease()

    def _assert_workflow_lease(self) -> None:
        worker_id = self._workflow_worker_id
        if not worker_id:
            return
        # Read scalar columns: the ORM identity map may still contain a former lease.
        row = self.db.execute(
            select(
                BucketMigration.worker_lease_owner,
                BucketMigration.worker_lease_until,
            ).where(BucketMigration.id == self._workflow_migration_id)
        ).one()
        if row.worker_lease_owner != worker_id or not row.worker_lease_until or row.worker_lease_until < utcnow():
            raise WorkerLeaseLostError("Migration worker lease lost")

    def _commit(self) -> None:
        commit_or_rollback(self.db)

    def _persist_migration_checkpoint(
        self,
        migration_id: int,
        mutate: Callable[[BucketMigration], None],
    ) -> BucketMigration:
        """Persist one replayable migration-only execution checkpoint."""

        def persist_once() -> int:
            current = self.db.get(BucketMigration, migration_id, populate_existing=True)
            if current is None:
                raise RuntimeError("Bucket migration disappeared while persisting execution state")
            mutate(current)
            self._commit()
            return migration_id

        run_db_unit_with_sqlite_retry(self.db, persist_once)
        current = self.db.get(BucketMigration, migration_id, populate_existing=True)
        if current is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("Bucket migration could not be reloaded after persisting execution state")
        return current

    def _persist_item_checkpoint(
        self,
        migration_id: int,
        item_id: int,
        mutate: Callable[[BucketMigration, BucketMigrationItem], None],
    ) -> tuple[BucketMigration, BucketMigrationItem]:
        """Persist one replayable DB-only migration item execution checkpoint."""

        def persist_once() -> tuple[int, int]:
            current_migration = self.db.get(
                BucketMigration,
                migration_id,
                populate_existing=True,
            )
            current_item = self.db.get(
                BucketMigrationItem,
                item_id,
                populate_existing=True,
            )
            if current_migration is None or current_item is None:
                raise RuntimeError("Bucket migration item disappeared while persisting execution state")
            mutate(current_migration, current_item)
            self._commit()
            return migration_id, item_id

        run_db_unit_with_sqlite_retry(self.db, persist_once)
        current_migration = self.db.get(BucketMigration, migration_id, populate_existing=True)
        current_item = self.db.get(BucketMigrationItem, item_id, populate_existing=True)
        if current_migration is None or current_item is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("Bucket migration item could not be reloaded after persisting execution state")
        return current_migration, current_item

    def _persist_sync_progress_checkpoint(
        self,
        migration_id: int,
        item_id: int,
        *,
        copied_inc: int = 0,
        deleted_inc: int = 0,
    ) -> tuple[BucketMigration, BucketMigrationItem]:
        """Persist counters after completed remote object operations."""

        copied_delta = max(0, int(copied_inc))
        deleted_delta = max(0, int(deleted_inc))

        def mutate(
            current_migration: BucketMigration,
            current_item: BucketMigrationItem,
        ) -> None:
            current_item.objects_copied = int(current_item.objects_copied) + copied_delta
            current_item.objects_deleted = int(current_item.objects_deleted) + deleted_delta
            heartbeat_at = utcnow()
            current_item.updated_at = heartbeat_at
            current_migration.updated_at = heartbeat_at

        return self._persist_item_checkpoint(
            migration_id,
            item_id,
            mutate,
        )

    def _is_context_authorized(self, context_id: str) -> bool:
        if self._authorized_context_ids is None:
            return True
        return normalize_optional_string(context_id) in self._authorized_context_ids

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
        user = self.db.scalars(
            select(User).where(
                User.id == user_id,
                User.is_active.is_(True),
            )
        ).first()
        if user is None:
            return set()
        return EffectiveAccessService(self.db).build_bucket_migration_scope(user, auth_session_id=self._execution_auth_session_id).allowed_context_ids

    def _assert_migration_creator_access(self, migration: BucketMigration) -> None:
        if str(migration.source_context_id).startswith("os-") or str(migration.target_context_id).startswith("os-"):
            self._execution_auth_session_id = self._request_auth_session_id or migration.execution_auth_session_id
            if self._request_auth_session_id:
                migration.execution_auth_session_id = self._request_auth_session_id
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
        normalized_context_id = normalize_optional_string(context_id)
        return bool(normalized_context_id and normalized_context_id.isdigit())

    def _assert_cross_account_admin_contexts(self, source_context_id: str, target_context_id: str) -> None:
        if self._admin_account_context_ids is None:
            return

        source_value = normalize_optional_string(source_context_id) or ""
        target_value = normalize_optional_string(target_context_id) or ""
        if source_value == target_value:
            return
        if not self._is_account_context_id(source_value) or not self._is_account_context_id(target_value):
            return
        if source_value in self._admin_account_context_ids and target_value in self._admin_account_context_ids:
            return
        raise PermissionError(
            "Cross-account migrations require admin access on both source and target account contexts"
        )
