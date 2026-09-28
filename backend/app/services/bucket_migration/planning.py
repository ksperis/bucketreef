# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import ipaddress
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import or_

from .workflow import require_action

from app.core.domain_errors import BucketMigrationNotFoundError
from app.db import BucketMigration, BucketMigrationEvent, BucketMigrationItem, User
from app.models.bucket_migration import BucketMigrationCreateRequest
from app.utils.time import utcnow

from ._shared import (
    _FINAL_MIGRATION_STATUSES,
    _RUNNABLE_MIGRATION_STATUSES,
    _json_dumps,
    _json_loads,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _DraftMigrationConfiguration:
    mappings: list[tuple[str, str]]
    use_same_endpoint_copy: bool
    auto_grant_source_read_for_copy: bool
    parallelism: int


class BucketMigrationPlanningMixin:
    def _transition_command(self, migration: BucketMigration, **values) -> None:
        """Fence competing commands before a worker or another editor can act."""
        changed = (
            self.db.query(BucketMigration)
            .filter(
                BucketMigration.id == migration.id,
                BucketMigration.status == migration.status,
                BucketMigration.configuration_revision
                == migration.configuration_revision,
                BucketMigration.preparation_status == migration.preparation_status,
                BucketMigration.maintenance_status == migration.maintenance_status,
            )
            .update(values, synchronize_session=False)
        )
        if changed != 1:
            self.db.rollback()
            raise ValueError("This migration changed. Reload it before trying again.")
        for name, value in values.items():
            setattr(migration, name, value)

    def _build_bucket_mappings(
        self, payload: BucketMigrationCreateRequest
    ) -> list[tuple[str, str]]:
        mappings: list[tuple[str, str]] = []
        seen_targets: set[str] = set()
        for entry in payload.buckets:
            source_bucket = (entry.source_bucket or "").strip()
            target_bucket = (
                (entry.target_bucket or "").strip()
                or f"{payload.mapping_prefix}{source_bucket}"
            ).strip()
            if not source_bucket:
                raise ValueError("source bucket is required")
            if not target_bucket:
                raise ValueError(
                    f"target bucket is required for source '{source_bucket}'"
                )
            invalid_name = (
                not re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", target_bucket)
                or ".." in target_bucket
                or ".-" in target_bucket
                or "-." in target_bucket
            )
            try:
                ipaddress.ip_address(target_bucket)
                invalid_name = True
            except ValueError:
                pass
            if (
                invalid_name
                or target_bucket.startswith(("xn--", "sthree-", "amzn-s3-demo-"))
                or target_bucket.endswith(
                    ("-s3alias", "--ol-s3", ".mrap", "--x-s3", "--table-s3")
                )
            ):
                raise ValueError(
                    f"Invalid destination bucket name '{target_bucket}'. Use 3–63 lowercase letters, numbers, dots or hyphens."
                )
            if target_bucket in seen_targets:
                raise ValueError(f"Duplicate target bucket mapping: {target_bucket}")
            seen_targets.add(target_bucket)
            mappings.append((source_bucket, target_bucket))
        return mappings

    def _resolve_same_endpoint_copy_options(
        self,
        payload: BucketMigrationCreateRequest,
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
        payload: BucketMigrationCreateRequest,
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
        payload: BucketMigrationCreateRequest,
        configuration: _DraftMigrationConfiguration,
    ) -> dict[str, object]:
        return {
            "source_context_id": payload.source_context_id,
            "target_context_id": payload.target_context_id,
            "mode": payload.mode,
            "copy_bucket_settings": bool(payload.copy_bucket_settings),
            "delete_source": bool(payload.delete_source),
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
            source_snapshot_json=None,
            target_snapshot_json=None,
            execution_plan_json=None,
            replication_state_json=None,
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
        item.target_bucket_exists = False
        item.objects_copied = 0
        item.objects_deleted = 0
        item.source_count = None
        item.target_count = None
        item.matched_count = None
        item.different_count = None
        item.only_source_count = None
        item.only_target_count = None
        item.diff_sample_json = None
        item.source_snapshot_json = None
        item.target_snapshot_json = None
        item.execution_plan_json = None
        item.replication_state_json = None
        item.source_policy_backup_json = None
        item.target_policy_backup_json = None
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
            created_by_user_id=user.id,
            source_context_id=payload.source_context_id,
            target_context_id=payload.target_context_id,
            mode=payload.mode,
            copy_bucket_settings=bool(payload.copy_bucket_settings),
            delete_source=False,
            strong_integrity_check=bool(payload.strong_integrity_check),
            lock_target_writes=bool(payload.lock_target_writes),
            use_same_endpoint_copy=configuration.use_same_endpoint_copy,
            auto_grant_source_read_for_copy=configuration.auto_grant_source_read_for_copy,
            mapping_prefix=payload.mapping_prefix or None,
            status="draft",
            precheck_status="pending",
            precheck_report_json=None,
            precheck_checked_at=None,
            parallelism_max=configuration.parallelism,
            total_items=len(configuration.mappings),
            completed_items=0,
            failed_items=0,
            skipped_items=0,
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
        self, migration_id: int, payload: BucketMigrationCreateRequest
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
        migration.checked_revision = None
        migration.preparation_status = "stale"
        migration.preparation_completed_items = 0

        migration.source_context_id = payload.source_context_id
        migration.target_context_id = payload.target_context_id
        migration.mode = payload.mode
        migration.copy_bucket_settings = bool(payload.copy_bucket_settings)
        migration.delete_source = False
        migration.strong_integrity_check = bool(payload.strong_integrity_check)
        migration.lock_target_writes = bool(payload.lock_target_writes)
        migration.use_same_endpoint_copy = configuration.use_same_endpoint_copy
        migration.auto_grant_source_read_for_copy = (
            configuration.auto_grant_source_read_for_copy
        )
        migration.mapping_prefix = payload.mapping_prefix or None
        migration.parallelism_max = configuration.parallelism
        migration.status = "draft"
        migration.pause_requested = False
        migration.cancel_requested = False
        migration.worker_lease_owner = None
        migration.worker_lease_until = None
        migration.precheck_status = "pending"
        migration.precheck_report_json = None
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

    def list_migrations(
        self, limit: int = 100, *, context_id: Optional[str] = None
    ) -> list[BucketMigration]:
        if (
            self._authorized_context_ids is not None
            and not self._authorized_context_ids
        ):
            return []
        query = self.db.query(BucketMigration)
        if self._authorized_context_ids is not None:
            query = query.filter(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        normalized_context_id = (context_id or "").strip()
        if normalized_context_id:
            if (
                self._authorized_context_ids is not None
                and normalized_context_id not in self._authorized_context_ids
            ):
                return []
            query = query.filter(
                or_(
                    BucketMigration.source_context_id == normalized_context_id,
                    BucketMigration.target_context_id == normalized_context_id,
                )
            )
        return (
            query.order_by(BucketMigration.created_at.desc())
            .limit(max(1, min(int(limit), 500)))
            .all()
        )

    def get_migration(self, migration_id: int) -> BucketMigration:
        query = self.db.query(BucketMigration).filter(
            BucketMigration.id == migration_id
        )
        if self._authorized_context_ids is not None:
            if not self._authorized_context_ids:
                raise BucketMigrationNotFoundError("Migration not found")
            query = query.filter(
                BucketMigration.source_context_id.in_(self._authorized_context_ids),
                BucketMigration.target_context_id.in_(self._authorized_context_ids),
            )
        migration = query.first()
        if not migration:
            raise BucketMigrationNotFoundError("Migration not found")
        return migration

    def list_migration_items(self, migration_id: int) -> list[BucketMigrationItem]:
        migration = self.get_migration(migration_id)
        return (
            self.db.query(BucketMigrationItem)
            .filter(BucketMigrationItem.migration_id == migration.id)
            .order_by(BucketMigrationItem.id.asc())
            .all()
        )

    def list_recent_migration_events(
        self, migration_id: int, *, limit: int
    ) -> list[BucketMigrationEvent]:
        migration = self.get_migration(migration_id)
        safe_limit = max(1, min(int(limit), 1000))
        return (
            self.db.query(BucketMigrationEvent)
            .filter(BucketMigrationEvent.migration_id == migration.id)
            .order_by(
                BucketMigrationEvent.created_at.desc(), BucketMigrationEvent.id.desc()
            )
            .limit(safe_limit)
            .all()
        )

    def delete_migration(self, migration_id: int) -> None:
        migration = self.get_migration(migration_id)
        if migration.status not in {*_FINAL_MIGRATION_STATUSES, "draft"}:
            raise ValueError(
                "Migration can only be deleted from a final status or from draft"
            )
        require_action(migration, "delete")
        self.db.delete(migration)
        self._commit()

    def start_migration(
        self,
        migration_id: int,
        *,
        configuration_revision: int | None = None,
        confirm_write_interruption: bool = False,
    ) -> BucketMigration:
        migration = self.get_migration(migration_id)
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
        try:
            self._revalidate_transfer_preconditions(migration)
        except ValueError as exc:
            migration.preparation_status = "stale"
            migration.checked_revision = None
            migration.precheck_status = "failed"
            report = _json_loads(migration.precheck_report_json) or {}
            from .precheck import _check_entry

            report["checks"] = [
                _check_entry(
                    code="start_precondition_changed",
                    severity="error",
                    blocking=True,
                    scope="migration",
                    message=str(exc),
                )
            ]
            report["errors"] = max(1, report.get("errors", 0))
            report["status"] = "failed"
            migration.precheck_report_json = _json_dumps(report)
            self._commit()
            raise
        if migration.status not in {"draft"}:
            raise ValueError("Migration cannot be started from current status")
        if migration.precheck_status != "passed":
            raise ValueError("Precheck must pass before start. Run /precheck first.")
        for item in migration.items:
            try:
                self._assert_item_execution_plan_supported(item)
            except RuntimeError as exc:
                raise ValueError(
                    "Precheck must be re-run before start. "
                    f"Item '{item.source_bucket}' -> '{item.target_bucket}' is not runnable: {exc}"
                ) from exc
        self._transition_command(migration, status="queued")
        migration.pause_requested = False
        migration.cancel_requested = False
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
            migration, status="pause_requested", pause_requested=True
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
        migration.pause_requested = False
        migration.cancel_requested = False
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
        self._transition_command(
            migration, status="cancel_requested", cancel_requested=True
        )
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
        migration.pause_requested = False
        migration.cancel_requested = False
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

    def claim_next_runnable_migration_id(
        self, *, worker_id: str, lease_seconds: int
    ) -> Optional[int]:
        if not worker_id:
            raise ValueError("worker_id is required to claim a migration lease")
        now = utcnow()
        lease_duration = max(15, int(lease_seconds))
        lease_until = now + timedelta(seconds=lease_duration)
        limits = self._load_runtime_limits()
        max_active_per_endpoint = max(1, int(limits.max_active_per_endpoint))
        endpoint_usage = self._active_endpoint_usage(now=now)
        endpoint_cache: dict[str, str] = {}
        candidate_rows = [
            row
            for row in (
                self.db.query(
                    BucketMigration.id,
                    BucketMigration.source_context_id,
                    BucketMigration.target_context_id,
                )
                .filter(
                    or_(
                        BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                        BucketMigration.maintenance_status.in_({"queued", "running"}),
                    ),
                    or_(
                        BucketMigration.worker_lease_until.is_(None),
                        BucketMigration.worker_lease_until < now,
                    ),
                )
                .order_by(BucketMigration.created_at.asc())
                .limit(50)
                .all()
            )
        ]
        for row in candidate_rows:
            migration_id = int(row.id)
            endpoint_keys = self._endpoint_keys_for_contexts(
                row.source_context_id,
                row.target_context_id,
                cache=endpoint_cache,
            )
            if any(
                endpoint_usage.get(key, 0) >= max_active_per_endpoint
                for key in endpoint_keys
            ):
                continue
            updated = (
                self.db.query(BucketMigration)
                .filter(
                    BucketMigration.id == migration_id,
                    or_(
                        BucketMigration.status.in_(_RUNNABLE_MIGRATION_STATUSES),
                        BucketMigration.maintenance_status.in_({"queued", "running"}),
                    ),
                    or_(
                        BucketMigration.worker_lease_until.is_(None),
                        BucketMigration.worker_lease_until < now,
                    ),
                )
                .update(
                    {
                        BucketMigration.worker_lease_owner: worker_id,
                        BucketMigration.worker_lease_until: lease_until,
                        BucketMigration.updated_at: now,
                    },
                    synchronize_session=False,
                )
            )
            if updated == 1:
                self._commit()
                if self._claimed_migration_within_endpoint_limit(
                    migration_id,
                    endpoint_keys=endpoint_keys,
                    max_active_per_endpoint=max_active_per_endpoint,
                    now=utcnow(),
                    cache=endpoint_cache,
                ):
                    return migration_id
                logger.info(
                    "Bucket migration claim released after endpoint limit recheck: migration=%s worker=%s",
                    migration_id,
                    worker_id,
                )
                self._release_migration_lease(migration_id, worker_id=worker_id)
                self._commit()
                endpoint_usage = self._active_endpoint_usage(now=utcnow())
                continue
            self.db.rollback()
        return None
