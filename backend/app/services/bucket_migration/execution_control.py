# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from sqlalchemy import or_, select
from typing import Callable, Optional

from app.core.config import get_settings
from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigration, BucketMigrationItem
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.time import utcnow
from ._shared import (
    _DB_ERROR_MESSAGE_MAX_CHARS,
    _FINAL_MIGRATION_STATUSES,
    _RUNNABLE_MIGRATION_STATUSES,
    _ResolvedContext,
    _WorkerLeaseLostError,
    _truncate_optional_db_text,
)

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

        if migration.status in {*_FINAL_MIGRATION_STATUSES, "awaiting_cutover"}:
            if self._clear_owned_worker_lease(migration, worker_id=worker_id):
                self._commit()
            return None

        if migration.status in _RUNNABLE_MIGRATION_STATUSES:
            now = utcnow()
            if migration.status not in {"pause_requested", "cancel_requested"}:
                migration.status = "running"
            if migration.started_at is None:
                migration.started_at = now
            migration.updated_at = now
            migration.last_heartbeat_at = now
            self._commit()
        return migration

    @staticmethod
    def _clear_owned_worker_lease(
        migration: BucketMigration,
        *,
        worker_id: Optional[str],
    ) -> bool:
        if not worker_id or migration.worker_lease_owner != worker_id:
            return False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        return True

    def _stop_for_control_state(
        self,
        migration: BucketMigration,
        state: str,
        *,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
    ) -> bool:
        if state == "lost_lease":
            return True
        if state == "cancel":
            self._mark_canceled(migration, source_ctx=source_ctx, target_ctx=target_ctx)
            self._commit()
            return True
        if state == "pause":
            self._mark_paused(migration)
            self._commit()
            return True
        return False

    def _execute_migration_item(
        self,
        migration: BucketMigration,
        item: BucketMigrationItem,
        source_ctx: _ResolvedContext,
        target_ctx: _ResolvedContext,
        *,
        control_check: Callable[[], str],
    ) -> Optional[BucketMigration]:
        try:
            self._execution_item = item
            self._revalidate_transfer_preconditions(migration, items=[item])
            item.status = "running"
            if item.started_at is None:
                item.started_at = utcnow()
            item.updated_at = utcnow()
            self._commit()
            self._run_item(
                migration,
                item,
                source_ctx,
                target_ctx,
                control_check=control_check,
            )
            return migration
        except _WorkerLeaseLostError:
            self.db.rollback()
            return None
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Bucket migration item failed: migration=%s item=%s",
                migration.id,
                item.id,
            )
            self.db.rollback()
            migration = self.get_migration(migration.id)
            failed_item = self.db.scalars(
                select(BucketMigrationItem).where(BucketMigrationItem.id == item.id)
            ).first()
            if failed_item is None:
                return migration
            error_detail = sanitized_error_log_detail(exc)
            failed_item.status = "failed"
            failed_item.error_message = _truncate_optional_db_text(
                error_detail,
                max_chars=_DB_ERROR_MESSAGE_MAX_CHARS,
            )
            failed_item.finished_at = utcnow()
            failed_item.updated_at = utcnow()
            self._add_event(
                migration,
                item=failed_item,
                level="error",
                message="Item failed.",
                metadata={"error": error_detail, "step": failed_item.step},
            )
            self._commit()
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
        if migration.status not in _RUNNABLE_MIGRATION_STATUSES:
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
                return

            if item.status in {"completed", "rolled_back", "skipped", "failed", "canceled"}:
                continue
            if migration.mode == "pre_sync" and migration.status == "awaiting_cutover":
                if self._clear_owned_worker_lease(migration, worker_id=worker_id):
                    self._commit()
                return

            migration = self._execute_migration_item(
                migration,
                item,
                source_ctx,
                target_ctx,
                control_check=control_check,
            )
            if migration is None:
                return

        self.db.refresh(migration)
        self._assert_workflow_lease()
        self._finalize_or_wait_cutover(migration, source_ctx=source_ctx, target_ctx=target_ctx)
        if migration.status not in _RUNNABLE_MIGRATION_STATUSES:
            self._clear_owned_worker_lease(migration, worker_id=worker_id)
        self._commit()

    def _active_endpoint_usage(self, *, now) -> dict[str, int]:
        usage: dict[str, int] = {}
        cache: dict[str, str] = {}
        rows = self.db.execute(
            select(
                BucketMigration.source_context_id,
                BucketMigration.target_context_id,
            ).where(
                or_(BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES), BucketMigration.maintenance_status.in_({"queued", "running"})),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
        ).all()
        for row in rows:
            for key in self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            ):
                usage[key] = usage.get(key, 0) + 1
        return usage

    def _claimed_migration_within_endpoint_limit(
        self,
        migration_id: int,
        *,
        endpoint_keys: set[str],
        max_active_per_endpoint: int,
        now,
        cache: dict[str, str],
    ) -> bool:
        if not endpoint_keys:
            return True
        allowed_per_endpoint = max(1, int(max_active_per_endpoint))
        rows = self.db.execute(
            select(
                BucketMigration.id,
                BucketMigration.source_context_id,
                BucketMigration.target_context_id,
            )
            .where(
                or_(BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES), BucketMigration.maintenance_status.in_({"queued", "running"})),
                BucketMigration.worker_lease_until.isnot(None),
                BucketMigration.worker_lease_until >= now,
            )
            .order_by(BucketMigration.created_at.asc(), BucketMigration.id.asc())
        ).all()
        ranked_by_endpoint: dict[str, list[int]] = {}
        for row in rows:
            row_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=cache,
            )
            for key in row_keys:
                ranked_by_endpoint.setdefault(key, []).append(int(row.id))
        for key in endpoint_keys:
            ranked_ids = ranked_by_endpoint.get(key, [])
            if migration_id not in ranked_ids:
                return False
            if ranked_ids.index(migration_id) >= allowed_per_endpoint:
                return False
        return True

    def _endpoint_keys_for_contexts(
        self,
        source_context_id: str,
        target_context_id: str,
        *,
        cache: dict[str, str],
    ) -> set[str]:
        source_key = self._context_endpoint_capacity_key(source_context_id, cache=cache)
        target_key = self._context_endpoint_capacity_key(target_context_id, cache=cache)
        keys = {source_key, target_key}
        return {key for key in keys if key}

    def _context_endpoint_capacity_key(self, context_id: str, *, cache: dict[str, str]) -> str:
        normalized_context_id = (context_id or "").strip()
        if not normalized_context_id:
            return "context:unknown"
        cached = cache.get(normalized_context_id)
        if cached is not None:
            return cached
        endpoint_key = f"context:{normalized_context_id}"
        try:
            ctx = self._resolve_context(normalized_context_id)
            endpoint = normalize_s3_endpoint(ctx.endpoint)
            if endpoint:
                endpoint_key = f"endpoint:{endpoint}"
        except Exception:
            logger.debug(
                "Unable to resolve endpoint for migration context '%s' while evaluating endpoint limits.",
                normalized_context_id,
                exc_info=True,
            )
        cache[normalized_context_id] = endpoint_key
        return endpoint_key
