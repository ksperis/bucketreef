# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime

from app.core.domain_errors import BucketMigrationItemNotFoundError
from app.db import BucketMigration, BucketMigrationItem
from app.utils.time import utcnow
from .workflow import ACTIVE_STATUSES, require_action


class BucketMigrationRetryMixin:
    def _find_migration_item(self, migration: BucketMigration, item_id: int) -> BucketMigrationItem:
        for item in migration.items:
            if item.id == item_id:
                return item
        raise BucketMigrationItemNotFoundError("Migration item not found")

    def _ensure_manual_item_operation_allowed(self, migration: BucketMigration) -> None:
        self._assert_migration_creator_access(migration)
        if migration.workflow_version != 2 or migration.maintenance_status in {"queued", "running"}:
            raise ValueError("Historical or busy migrations cannot be replayed")
        if migration.status in ACTIVE_STATUSES:
            raise ValueError("Bucket-level actions are not available while migration is active")

    def _retry_step_for_failed_item(self, item: BucketMigrationItem) -> str:
        if item.step == "verify":
            return "sync"
        return item.step

    def _prepare_item_retry(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        *,
        updated_at: datetime,
    ) -> None:
        item.status = "pending"
        item.step = self._retry_step_for_failed_item(item)
        item.error_message = None
        item.finished_at = None
        item.updated_at = updated_at
        self._add_event(
            migration,
            item=item,
            level="info",
            message="Retry requested for bucket item.",
            metadata={"retry_step": item.step},
        )

    def _prepare_migration_retry(
        self,
        migration: BucketMigration,
        *,
        message: str,
        updated_at: datetime,
    ) -> None:
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.updated_at = updated_at
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
        item_id = int(item.id)
        source_bucket = str(item.source_bucket)
        updated_at = utcnow()

        def mutate(current: BucketMigration) -> None:
            current_item = self._find_migration_item(current, item_id)
            if current_item.status != "failed":
                raise ValueError("Retry is only available for failed bucket items")
            self._prepare_item_retry(
                current,
                current_item,
                updated_at=updated_at,
            )
            self._prepare_migration_retry(
                current,
                message=f"Retry requested for bucket '{source_bucket}'.",
                updated_at=updated_at,
            )

        return self._persist_transition_command(
            migration,
            values={"status": "queued"},
            mutate=mutate,
        )

    def retry_failed_items(self, migration_id: int) -> tuple[BucketMigration, int]:
        migration = self.get_migration(migration_id)
        self._ensure_manual_item_operation_allowed(migration)
        failed_items = [item for item in migration.items if item.status == "failed"]
        if not failed_items:
            raise ValueError("No failed bucket items to retry")

        require_action(migration, "retry")
        self._revalidate_transfer_preconditions(migration, items=failed_items)
        failed_item_ids = tuple(int(item.id) for item in failed_items)
        retried_count = len(failed_item_ids)
        updated_at = utcnow()

        def mutate(current: BucketMigration) -> None:
            current_items = [
                self._find_migration_item(current, item_id)
                for item_id in failed_item_ids
            ]
            if any(item.status != "failed" for item in current_items):
                raise ValueError("One or more failed bucket items changed. Reload and retry.")
            for current_item in current_items:
                self._prepare_item_retry(
                    current,
                    current_item,
                    updated_at=updated_at,
                )
            self._prepare_migration_retry(
                current,
                message=f"Retry requested for {retried_count} failed bucket item(s).",
                updated_at=updated_at,
            )

        current = self._persist_transition_command(
            migration,
            values={"status": "queued"},
            mutate=mutate,
        )
        return current, retried_count
