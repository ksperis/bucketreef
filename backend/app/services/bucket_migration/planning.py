# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import update

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import BucketMigration, BucketMigrationItem, User
from app.models.bucket_migration import (
    BucketMigrationCreateRequest,
    BucketMigrationDraftRequest,
    BucketMigrationUpdateRequest,
)
from app.utils.resource_names import validate_s3_bucket_name
from app.utils.time import utcnow

from .precheck_reporting import build_diagnostic
from .workflow import FINAL_STATUSES, preparation_is_current, require_action


@dataclass(frozen=True)
class _DraftMigrationConfiguration:
    mappings: list[tuple[str, str]]
    use_same_endpoint_copy: bool
    auto_grant_source_read_for_copy: bool
    parallelism: int


class BucketMigrationPlanningMixin:
    def _transition_command(
        self,
        migration: BucketMigration,
        *,
        allowed_statuses: tuple[str, ...] | None = None,
        **values,
    ) -> None:
        """Fence competing commands before a worker or another editor can act."""
        status_filter = (
            BucketMigration.status.in_(allowed_statuses)
            if allowed_statuses
            else BucketMigration.status == migration.status
        )
        changed = self.db.execute(
            update(BucketMigration)
            .where(
                BucketMigration.id == migration.id,
                status_filter,
                BucketMigration.configuration_revision
                == migration.configuration_revision,
                BucketMigration.preparation_status == migration.preparation_status,
                BucketMigration.maintenance_status == migration.maintenance_status,
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        ).rowcount
        if changed != 1:
            self.db.rollback()
            raise ValueError("This migration changed. Reload it before trying again.")
        for name, value in values.items():
            setattr(migration, name, value)

    def _build_bucket_mappings(
        self, payload: BucketMigrationDraftRequest
    ) -> list[tuple[str, str]]:
        mappings: list[tuple[str, str]] = []
        seen_targets: set[str] = set()
        for entry in payload.buckets:
            source_bucket = (entry.source_bucket or "").strip()
            target_bucket = (entry.target_bucket or "").strip()
            if not source_bucket:
                raise ValueError("source bucket is required")
            if not target_bucket:
                raise ValueError(
                    f"target bucket is required for source '{source_bucket}'"
                )
            try:
                validate_s3_bucket_name(target_bucket)
            except ValueError as exc:
                raise ValueError(
                    f"Invalid destination bucket name '{target_bucket}'. Use 3–63 lowercase letters, numbers, dots or hyphens."
                ) from exc
            if target_bucket in seen_targets:
                raise ValueError(f"Duplicate target bucket mapping: {target_bucket}")
            seen_targets.add(target_bucket)
            mappings.append((source_bucket, target_bucket))
        return mappings

    def _resolve_same_endpoint_copy_options(
        self,
        payload: BucketMigrationDraftRequest,
        *,
        same_endpoint: bool,
    ) -> tuple[bool, bool]:
        use_same_endpoint_copy = bool(payload.use_same_endpoint_copy)
        explicit_auto_grant = payload.auto_grant_source_read_for_copy

        if use_same_endpoint_copy and not same_endpoint:
            raise ValueError(
                "x-amz-copy-source can only be enabled when source and target contexts use the same endpoint"
            )
        if not use_same_endpoint_copy and explicit_auto_grant is True:
            raise ValueError(
                "auto_grant_source_read_for_copy cannot be enabled when use_same_endpoint_copy is disabled"
            )

        if explicit_auto_grant is None:
            auto_grant_source_read_for_copy = False
        else:
            auto_grant_source_read_for_copy = bool(explicit_auto_grant)

        if not use_same_endpoint_copy:
            auto_grant_source_read_for_copy = False

        return use_same_endpoint_copy, auto_grant_source_read_for_copy

    def _resolve_draft_configuration(
        self,
        payload: BucketMigrationDraftRequest,
    ) -> _DraftMigrationConfiguration:
        mappings = self._build_bucket_mappings(payload)
        self._assert_context_authorized_for_mutation(payload.source_context_id)
        self._assert_context_authorized_for_mutation(payload.target_context_id)
        self._assert_cross_account_admin_contexts(
            payload.source_context_id, payload.target_context_id
        )

        source_ctx = self._resolve_context(payload.source_context_id)
        target_ctx = self._resolve_context(payload.target_context_id)
        if not source_ctx.endpoint:
            raise ValueError("Source context endpoint is not configured")
        if not target_ctx.endpoint:
            raise ValueError("Target context endpoint is not configured")
        same_endpoint = self._is_same_endpoint(source_ctx, target_ctx)
        if same_endpoint and any(source == target for source, target in mappings):
            raise ValueError(
                "When source and target contexts use the same endpoint, "
                "target bucket must differ from source bucket. "
                "Use a prefix or explicit mapping override."
            )
        use_same_endpoint_copy, auto_grant_source_read_for_copy = (
            self._resolve_same_endpoint_copy_options(
                payload,
                same_endpoint=same_endpoint,
            )
        )

        limits = self._load_runtime_limits()
        requested_parallelism = (
            int(payload.parallelism_max)
            if payload.parallelism_max is not None
            else int(limits.parallelism_default)
        )
        return _DraftMigrationConfiguration(
            mappings=mappings,
            use_same_endpoint_copy=use_same_endpoint_copy,
            auto_grant_source_read_for_copy=auto_grant_source_read_for_copy,
            parallelism=max(1, min(requested_parallelism, int(limits.parallelism_max))),
        )

    @staticmethod
    def _configuration_event_metadata(
        payload: BucketMigrationDraftRequest,
        configuration: _DraftMigrationConfiguration,
    ) -> dict[str, object]:
        return {
            "source_context_id": payload.source_context_id,
            "target_context_id": payload.target_context_id,
            "mode": payload.mode,
            "copy_bucket_settings": bool(payload.copy_bucket_settings),
            "strong_integrity_check": bool(payload.strong_integrity_check),
            "lock_target_writes": bool(payload.lock_target_writes),
            "use_same_endpoint_copy": configuration.use_same_endpoint_copy,
            "auto_grant_source_read_for_copy": configuration.auto_grant_source_read_for_copy,
            "parallelism_max": configuration.parallelism,
            "items": len(configuration.mappings),
        }

    @staticmethod
    def _build_draft_item(
        migration_id: int,
        source_bucket: str,
        target_bucket: str,
        *,
        timestamp: datetime,
    ) -> BucketMigrationItem:
        return BucketMigrationItem(
            migration_id=migration_id,
            source_bucket=source_bucket,
            target_bucket=target_bucket,
            status="pending",
            step="create_bucket",
            source_snapshot=None,
            execution_strategy=None,
            replication_state=None,
            created_at=timestamp,
            updated_at=timestamp,
        )

    @staticmethod
    def _reset_draft_item(
        item: BucketMigrationItem,
        target_bucket: str,
        *,
        timestamp: datetime,
    ) -> None:
        item.target_bucket = target_bucket
        item.status = "pending"
        item.step = "create_bucket"
        item.pre_sync_done = False
        item.read_only_applied = False
        item.target_lock_applied = False
        item.objects_copied = 0
        item.objects_deleted = 0
        item.source_count = None
        item.target_count = None
        item.matched_count = None
        item.different_count = None
        item.only_source_count = None
        item.only_target_count = None
        item.diff_sample = None
        item.source_snapshot = None
        item.execution_strategy = None
        item.replication_state = None
        item.source_policy_backup = None
        item.target_policy_backup = None
        item.error_message = None
        item.started_at = None
        item.finished_at = None
        item.updated_at = timestamp

    def _synchronize_draft_items(
        self,
        migration: BucketMigration,
        mappings: list[tuple[str, str]],
    ) -> None:
        item_by_source = {item.source_bucket: item for item in migration.items}
        mapping_by_source = dict(mappings)
        for source_bucket, item in item_by_source.items():
            if source_bucket not in mapping_by_source:
                self.db.delete(item)

        timestamp = utcnow()
        for source_bucket, target_bucket in mappings:
            item = item_by_source.get(source_bucket)
            if item is None:
                self.db.add(
                    self._build_draft_item(
                        migration.id,
                        source_bucket,
                        target_bucket,
                        timestamp=timestamp,
                    )
                )
            else:
                self._reset_draft_item(item, target_bucket, timestamp=timestamp)

    def create_migration(
        self, payload: BucketMigrationCreateRequest, user: User
    ) -> BucketMigration:
        configuration = self._resolve_draft_configuration(payload)

        migration = BucketMigration(
            execution_auth_session_id=self._execution_auth_session_id,
            created_by_user_id=user.id,
            source_context_id=payload.source_context_id,
            target_context_id=payload.target_context_id,
            mode=payload.mode,
            copy_bucket_settings=bool(payload.copy_bucket_settings),
            strong_integrity_check=bool(payload.strong_integrity_check),
            lock_target_writes=bool(payload.lock_target_writes),
            use_same_endpoint_copy=configuration.use_same_endpoint_copy,
            auto_grant_source_read_for_copy=configuration.auto_grant_source_read_for_copy,
            status="draft",
            precheck_report=None,
            precheck_checked_at=None,
            parallelism_max=configuration.parallelism,
            total_items=len(configuration.mappings),
            completed_items=0,
            failed_items=0,
            canceled_items=0,
            awaiting_items=0,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(migration)
        self.db.flush()

        for source_bucket, target_bucket in configuration.mappings:
            self.db.add(
                self._build_draft_item(
                    migration.id,
                    source_bucket,
                    target_bucket,
                    timestamp=utcnow(),
                )
            )

        self._add_event(
            migration,
            level="info",
            message="Migration created.",
            metadata=self._configuration_event_metadata(payload, configuration),
        )
        self._commit()
        self.db.refresh(migration)
        return migration
    def update_draft_migration(
        self, migration_id: int, payload: BucketMigrationUpdateRequest
    ) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status != "draft":
            raise ValueError("Only draft migrations can be updated")

        require_action(migration, "edit")
        if payload.configuration_revision != migration.configuration_revision:
            raise ValueError(
                "This draft changed. Reload it before saving your changes."
            )
        configuration = self._resolve_draft_configuration(payload)
        self._transition_command(
            migration,
            configuration_revision=migration.configuration_revision + 1,
            preparation_status="stale",
        )
        migration.preparation_status = "stale"
        migration.preparation_completed_items = 0

        migration.source_context_id = payload.source_context_id
        migration.target_context_id = payload.target_context_id
        migration.mode = payload.mode
        migration.copy_bucket_settings = bool(payload.copy_bucket_settings)
        migration.strong_integrity_check = bool(payload.strong_integrity_check)
        migration.lock_target_writes = bool(payload.lock_target_writes)
        migration.use_same_endpoint_copy = configuration.use_same_endpoint_copy
        migration.auto_grant_source_read_for_copy = (
            configuration.auto_grant_source_read_for_copy
        )
        migration.parallelism_max = configuration.parallelism
        migration.status = "draft"
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.precheck_report = None
        migration.precheck_checked_at = None
        migration.error_message = None
        migration.started_at = None
        migration.finished_at = None
        migration.last_heartbeat_at = None
        migration.updated_at = utcnow()

        self._synchronize_draft_items(migration, configuration.mappings)

        self.db.flush()
        self.db.refresh(migration)
        self._recompute_counters(migration)
        migration.updated_at = utcnow()

        self._add_event(
            migration,
            level="info",
            message="Migration configuration updated.",
            metadata=self._configuration_event_metadata(payload, configuration),
        )
        self._commit()
        self.db.refresh(migration)
        return migration
    def delete_migration(self, migration_id: int) -> None:
        migration = self.get_migration(migration_id)
        if migration.status not in {*FINAL_STATUSES, "draft"}:
            raise ValueError(
                "Migration can only be deleted from a final status or from draft"
            )
        require_action(migration, "delete")
        self.db.delete(migration)
        self._commit()

    def _validate_start_request(
        self,
        migration: BucketMigration,
        *,
        configuration_revision: int | None,
        confirm_write_interruption: bool,
    ) -> None:
        self._assert_migration_creator_access(migration)
        self._assert_cross_account_admin_contexts(
            migration.source_context_id, migration.target_context_id
        )
        require_action(migration, "start")
        if configuration_revision != migration.configuration_revision:
            raise ValueError(
                "The checked configuration revision must match the current draft"
            )
        if migration.mode == "one_shot" and not confirm_write_interruption:
            raise ValueError(
                "Confirm the source write interruption before starting an immediate migration"
            )

    def _record_start_precondition_failure(
        self,
        migration: BucketMigration,
        exc: ValueError,
    ) -> None:
        migration.preparation_status = "stale"
        report = dict(migration.precheck_report or {})
        report["checks"] = [
            build_diagnostic(
                code="start_precondition_changed",
                severity="error",
                blocking=True,
                scope="migration",
                message=sanitized_error_log_detail(exc),
            )
        ]
        report["errors"] = max(1, report.get("errors", 0))
        report["status"] = "failed"
        migration.precheck_report = report
        self._commit()

    def _revalidate_start_preconditions(self, migration: BucketMigration) -> None:
        try:
            self._revalidate_transfer_preconditions(migration)
        except ValueError as exc:
            self._record_start_precondition_failure(migration, exc)
            raise

    def _validate_start_execution_plan(self, migration: BucketMigration) -> None:
        if migration.status != "draft":
            raise ValueError("Migration cannot be started from current status")
        if not preparation_is_current(migration):
            raise ValueError("Precheck must pass before start. Run /precheck first.")
        for item in migration.items:
            try:
                self._assert_item_execution_strategy_supported(item)
            except RuntimeError as exc:
                raise ValueError(
                    "Precheck must be re-run before start. "
                    f"Item '{item.source_bucket}' -> '{item.target_bucket}' is not runnable: {exc}"
                ) from exc

    def _queue_migration_for_start(self, migration: BucketMigration) -> None:
        self._transition_command(migration, status="queued")
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.error_message = None
        migration.updated_at = utcnow()
        if migration.started_at is None:
            migration.started_at = utcnow()
        for item in migration.items:
            if item.status == "paused":
                item.status = "pending"
            if item.status == "awaiting_cutover" and migration.mode != "pre_sync":
                item.status = "pending"
                item.step = "apply_read_only"
            item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration queued.")
        self._commit()

    def start_migration(
        self,
        migration_id: int,
        *,
        configuration_revision: int | None = None,
        confirm_write_interruption: bool = False,
    ) -> BucketMigration:
        migration = self.get_migration(migration_id)
        self._validate_start_request(
            migration,
            configuration_revision=configuration_revision,
            confirm_write_interruption=confirm_write_interruption,
        )
        self._revalidate_start_preconditions(migration)
        self._validate_start_execution_plan(migration)
        self._queue_migration_for_start(migration)
        self.db.refresh(migration)
        return migration

    def request_pause(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        if migration.status not in {"queued", "running", "pause_requested"}:
            raise ValueError(
                "Pause is only available while migration is queued or running"
            )
        require_action(migration, "pause")
        self._transition_command(
            migration,
            allowed_statuses=("queued", "running", "pause_requested"),
            status="pause_requested",
        )
        migration.updated_at = utcnow()
        self._add_event(migration, level="info", message="Pause requested.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def resume_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        require_action(migration, "resume")
        self._revalidate_transfer_preconditions(migration)
        if migration.status not in {"paused"}:
            raise ValueError("Resume is only available from paused status")
        self._transition_command(migration, status="queued")
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "paused":
                item.status = "pending"
                item.updated_at = utcnow()
        self._add_event(migration, level="info", message="Migration resumed.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def stop_migration(self, migration_id: int) -> BucketMigration:
        migration = self.get_migration(migration_id)
        require_action(migration, "stop")
        self._transition_command(migration, status="cancel_requested")
        migration.updated_at = utcnow()
        self._add_event(migration, level="info", message="Stop requested.")
        self._commit()
        self.db.refresh(migration)
        return migration

    def continue_after_presync(
        self, migration_id: int, *, confirmed: bool = False
    ) -> BucketMigration:
        migration = self.get_migration(migration_id)
        require_action(migration, "cutover")
        if not confirmed:
            raise ValueError("Confirm source write interruption before cutover")
        self._revalidate_transfer_preconditions(migration)
        if migration.status != "awaiting_cutover":
            raise ValueError(
                "Continue is only available when migration is awaiting cutover"
            )
        self._transition_command(migration, status="queued")
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.updated_at = utcnow()
        for item in migration.items:
            if item.status == "awaiting_cutover":
                item.status = "pending"
                item.step = "apply_read_only"
                item.updated_at = utcnow()
        self._add_event(
            migration, level="info", message="Cutover requested after pre-sync."
        )
        self._commit()
        self.db.refresh(migration)
        return migration
