# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from sqlalchemy import update
from typing import Callable, Optional

from app.core.config import get_settings
from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigration, BucketMigrationItem
from app.utils.time import utcnow
from .persistence_safety import (
    DB_ERROR_MESSAGE_MAX_CHARS,
    truncate_optional_db_text,
)
from .execution_runtime import ResolvedContext
from .execution_signals import WorkerLeaseLostError
from .workflow import ACTIVE_STATUSES, FINAL_STATUSES

logger = logging.getLogger(__name__)
settings = get_settings()


class BucketMigrationExecutionControlMixin:
    def _prepare_migration_run(
        self,
        migration: BucketMigration,
        *,
        worker_id: Optional[str],
        lease_seconds: int,
    ) -> Optional[BucketMigration]:
        if worker_id:
            if migration.worker_lease_owner != worker_id:
                return None
            if not self._renew_migration_lease(
                migration.id,
                worker_id=worker_id,
                lease_seconds=lease_seconds,
            ):
                return None
            migration = self.get_migration(migration.id)

        if migration.status in {*FINAL_STATUSES, "awaiting_cutover"}:
            if worker_id and migration.worker_lease_owner == worker_id:
                self._release_migration_lease(migration.id, worker_id=worker_id)
            return None

        if migration.status in ACTIVE_STATUSES:
            now = utcnow()
            migration_id = int(migration.id)

            def mark_running(current: BucketMigration) -> None:
                if current.status not in ACTIVE_STATUSES:
                    return
                if current.status not in {"pause_requested", "cancel_requested"}:
                    self.db.execute(
                        update(BucketMigration)
                        .where(
                            BucketMigration.id == migration_id,
                            BucketMigration.status.in_(("queued", "running")),
                        )
                        .values(status="running")
                        .execution_options(synchronize_session=False)
                    )
                current.updated_at = now

            migration = self._persist_migration_checkpoint(migration_id, mark_running)
        return migration

    def _stop_for_control_state(
        self,
        migration: BucketMigration,
        state: str,
        *,
        source_ctx: ResolvedContext,
        target_ctx: ResolvedContext,
    ) -> bool:
        if state == "lost_lease":
            return True
        if state == "cancel":
            self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
            return True
        if state == "pause":
            self._mark_paused(migration)
            return True
        return False

    def _execute_migration_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: ResolvedContext,
        target_ctx: ResolvedContext,
        *,
        control_check: Callable[[], str],
    ) -> Optional[BucketMigration]:
        migration_id = int(migration.id)
        item_id = int(item.id)
        try:
            self._execution_item = item
            self._revalidate_transfer_preconditions(migration, items=[item])
            started_at = utcnow()

            def mark_item_running(
                current_migration: BucketMigration,
                current_item: BucketMigrationItem,
            ) -> None:
                current_item.status = "running"
                if current_item.started_at is None:
                    current_item.started_at = started_at
                current_item.updated_at = started_at

            migration, item = self._persist_item_checkpoint(
                migration_id,
                item_id,
                mark_item_running,
            )
            self._execution_item = item
            self._run_item(
                migration,
                item,
                source_ctx,
                target_ctx,
                control_check=control_check,
            )
            return migration
        except WorkerLeaseLostError:
            self.db.rollback()
            return None
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Bucket migration item failed: migration=%s item=%s",
                migration_id,
                item_id,
            )
            self.db.rollback()
            error_detail = sanitized_error_log_detail(exc)
            failed_at = utcnow()

            def mark_item_failed(
                current_migration: BucketMigration,
                failed_item: BucketMigrationItem,
            ) -> None:
                failed_item.status = "failed"
                failed_item.error_message = truncate_optional_db_text(
                    error_detail,
                    max_chars=DB_ERROR_MESSAGE_MAX_CHARS,
                )
                failed_item.finished_at = failed_at
                failed_item.updated_at = failed_at
                self._add_event(
                    current_migration,
                    item=failed_item,
                    level="error",
                    message="Item failed.",
                    metadata={"error": error_detail, "step": failed_item.step},
                )

            migration, _failed_item = self._persist_item_checkpoint(
                migration_id,
                item_id,
                mark_item_failed,
            )
            return migration

    def _run_migration_items(
        self,
        migration: BucketMigration,
        source_ctx: ResolvedContext,
        target_ctx: ResolvedContext,
        *,
        worker_id: Optional[str],
        control_check: Callable[[], str],
    ) -> Optional[BucketMigration]:
        for item in migration.items:
            self.db.refresh(migration)
            self._assert_migration_creator_access(migration)
            state = control_check()
            if self._stop_for_control_state(
                migration,
                state,
                source_ctx=source_ctx,
                target_ctx=target_ctx,
            ):
                return None

            if item.status in {"completed", "failed", "canceled"}:
                continue
            if migration.mode == "pre_sync" and migration.status == "awaiting_cutover":
                if worker_id and migration.worker_lease_owner == worker_id:
                    self._release_migration_lease(migration.id, worker_id=worker_id)
                return None

            migration = self._execute_migration_item(
                migration,
                item,
                source_ctx,
                target_ctx,
                control_check=control_check,
            )
            if migration is None:
                return None
        return migration

    def run_migration(
        self,
        migration_id: int,
        *,
        worker_id: Optional[str] = None,
        lease_seconds: Optional[int] = None,
    ) -> None:
        effective_lease_seconds = max(15, int(lease_seconds or settings.bucket_migration_worker_lease_seconds))
        migration = self.get_migration(migration_id)
        self._bind_workflow_lease(migration_id, worker_id)
        self._assert_migration_creator_access(migration)
        if migration.maintenance_status in {"queued", "running"}:
            self.run_maintenance(migration_id, worker_id=worker_id, lease_seconds=effective_lease_seconds)
            return
        if migration.workflow_version != 2:
            raise ValueError("Historical migrations cannot be replayed")
        if migration.status not in ACTIVE_STATUSES:
            return

        migration = self._prepare_migration_run(
            migration,
            worker_id=worker_id,
            lease_seconds=effective_lease_seconds,
        )
        if migration is None:
            return

        source_ctx = self._resolve_context(migration.source_context_id)
        target_ctx = self._resolve_context(migration.target_context_id)

        def control_check():
            current = self.get_migration(migration.id)
            self._assert_migration_creator_access(current)
            return self._control_state(
                migration.id,
                worker_id=worker_id,
                lease_seconds=effective_lease_seconds,
            )

        migration = self._run_migration_items(
            migration,
            source_ctx,
            target_ctx,
            worker_id=worker_id,
            control_check=control_check,
        )
        if migration is None:
            return

        self.db.refresh(migration)
        self._assert_workflow_lease()
        state = control_check()
        if self._stop_for_control_state(
            migration,
            state,
            source_ctx=source_ctx,
            target_ctx=target_ctx,
        ):
            return
        self.db.refresh(migration)
        self._assert_workflow_lease()
        migration = self._finalize_or_wait_cutover(
            migration,
            source_ctx=source_ctx,
            target_ctx=target_ctx,
        )
