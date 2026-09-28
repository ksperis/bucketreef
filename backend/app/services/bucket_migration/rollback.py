# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


from app.core.domain_errors import BucketMigrationItemNotFoundError
from app.db import BucketMigration, BucketMigrationItem
from app.utils.time import utcnow
from .workflow import require_action
from ._shared import _RUNNABLE_MIGRATION_STATUSES


class BucketMigrationRollbackMixin:
    def _find_migration_item(self, migration: BucketMigration, item_id: int) -> BucketMigrationItem:
        for item in migration.items:
            if item.id == item_id:
                return item
        raise BucketMigrationItemNotFoundError("Migration item not found")

    def _ensure_manual_item_operation_allowed(self, migration: BucketMigration) -> None:
        self._assert_migration_creator_access(migration)
        if migration.workflow_version != 2 or migration.maintenance_status in {"queued", "running"}:
            raise ValueError("Historical or busy migrations cannot be replayed")
        if migration.status in _RUNNABLE_MIGRATION_STATUSES:
            raise ValueError("Bucket-level actions are not available while migration is active")

    def _retry_step_for_failed_item(self, item: BucketMigrationItem) -> str:
        if item.step in {"verify", "rollback_failed"}:
            return "sync"
        return item.step or "create_bucket"

    def _prepare_item_retry(self, migration: BucketMigration, item: BucketMigrationItem) -> None:
        item.status = "pending"
        item.step = self._retry_step_for_failed_item(item)
        item.error_message = None
        item.finished_at = None
        item.updated_at = utcnow()
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Retry requested for bucket item.",
            metadata={"retry_step": item.step},
        )

    def _queue_migration_for_retry(self, migration: BucketMigration, *, message: str) -> None:
        self._transition_command(migration, status="queued")
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.finished_at = None
        migration.updated_at = utcnow()
        if migration.started_at is None:
            migration.started_at = utcnow()
        self._recompute_counters(migration)
        self._add_event(
            migration,
            level="info",
            message=message,
        )

    def retry_item(self, migration_id: int, item_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        item = self._find_migration_item(migration, item_id)
        self._ensure_manual_item_operation_allowed(migration)
        if item.status != "failed":
            raise ValueError("Retry is only available for failed bucket items")

        require_action(migration, "retry")
        self._revalidate_transfer_preconditions(migration, items=[item])
        self._prepare_item_retry(migration, item)
        self._queue_migration_for_retry(migration, message=f"Retry requested for bucket '{item.source_bucket}'.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def retry_failed_items(self, migration_id: int) -> tuple[BucketMigration, int]:
        migration = self.get_migration(migration_id)
        self._ensure_manual_item_operation_allowed(migration)
        failed_items = [item for item in migration.items if item.status == "failed"]
        if not failed_items:
            raise ValueError("No failed bucket items to retry")

        require_action(migration, "retry")
        self._revalidate_transfer_preconditions(migration, items=failed_items)
        for item in failed_items:
            self._prepare_item_retry(migration, item)

        self._queue_migration_for_retry(
            migration,
            message=f"Retry requested for {len(failed_items)} failed bucket item(s).",
        )
        self._commit()
        self.db.refresh(migration)
        return migration, len(failed_items)

    def rollback_item(self, migration_id: int, item_id: int):
        migration = self.get_migration(migration_id)
        self._find_migration_item(migration, item_id)
        raise ValueError("Use the separate restore-access or cleanup-target operation")

    def rollback_failed_items(self, migration_id: int):
        self.get_migration(migration_id)
        raise ValueError("Use the separate restore-access or cleanup-target operation")

    def rollback_failed_migration(self, migration_id: int):
        self.get_migration(migration_id)
        raise ValueError("Use the separate restore-access or cleanup-target operation")
