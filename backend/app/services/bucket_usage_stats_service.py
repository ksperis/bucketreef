# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime
from time import monotonic
from typing import Any, Callable, Iterable

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.db.bucket_usage_stats import BucketUsageStatsSnapshot as BucketUsageStatsSnapshotRow
from app.models.bucket_usage_stats import (
    BucketUsageStatsAggregate,
    BucketUsageStatsBucketResult,
    BucketUsageStatsDistributionEntry,
    BucketUsageStatsProgress,
    BucketUsageStatsResult,
    BucketUsageStatsScanMode,
    BucketUsageStatsSnapshot,
    BucketUsageStatsStatus,
)
from app.services.bucket_usage_stats_scan import (
    BucketUsageScan,
    ObjectVersionEntry,
)
from app.services.bucket_usage_stats_aggregation import build_bucket_usage_aggregate
from app.services.long_running_s3_client import LongRunningS3ClientMixin
from app.services.operation_lease_service import (
    BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
    OperationLeaseHandle,
    OperationLeaseService,
    bucket_usage_stats_bucket_operation_name,
)
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.aws_errors import aws_error_code
from app.utils.s3_errors import format_s3_error
from app.utils.time import utcnow


ProgressCallback = Callable[[BucketUsageStatsProgress], None]
CancelCheck = Callable[[], None]
logger = logging.getLogger(__name__)


class BucketUsageStatsCancelled(RuntimeError):
    pass


@dataclass(frozen=True)
class BucketUsageStatsResolvedTarget:
    context: S3ExecutionTarget
    bucket_name: str
    scope_kind: str
    scope_id: str
    bucket_tenant: str = ""
    request_bucket_name: str | None = None
    scope_name: str | None = None
    context_id: str | None = None
    context_name: str | None = None

    @property
    def s3_bucket_name(self) -> str:
        return self.request_bucket_name or self.bucket_name


@dataclass(frozen=True)
class BucketUsageStatsAggregateTarget:
    scope_kind: str
    scope_id: str
    bucket_name: str
    bucket_tenant: str = ""


@dataclass(frozen=True)
class BucketUsageStatsOptions:
    parallelism: int = 8


@dataclass
class _BucketUsageRunTotals:
    completed_buckets: int = 0
    failed_buckets: int = 0
    skipped_buckets: int = 0
    listed_versions: int = 0
    listed_delete_markers: int = 0
    total_bytes: int = 0

    def include(self, result: BucketUsageStatsBucketResult) -> None:
        self.completed_buckets += 1
        if result.status == "failed":
            self.failed_buckets += 1
        elif result.status == "skipped":
            self.skipped_buckets += 1
        if result.snapshot:
            self.listed_versions += result.snapshot.object_version_count
            self.listed_delete_markers += result.snapshot.delete_marker_count
            self.total_bytes += result.snapshot.total_bytes

    def status(self, total_buckets: int) -> BucketUsageStatsStatus:
        if self.failed_buckets == total_buckets and total_buckets:
            return "failed"
        if self.failed_buckets or self.skipped_buckets:
            return "completed_with_warnings"
        return "completed"


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)


def _load_distribution_entries(
    value: str,
) -> list[BucketUsageStatsDistributionEntry]:
    payload = json.loads(value)
    if not isinstance(payload, list):
        raise ValueError("Bucket usage distribution must be a JSON list")
    return [BucketUsageStatsDistributionEntry.model_validate(entry) for entry in payload]


def _load_warnings(value: str | None) -> list[str]:
    if value is None:
        return []
    payload = json.loads(value)
    if not isinstance(payload, list) or any(
        not isinstance(item, str) for item in payload
    ):
        raise ValueError("Bucket usage warnings must be a JSON string list")
    return payload


def _is_version_listing_unsupported(exc: Exception) -> bool:
    code = aws_error_code(exc, lowercase=True)
    if code in {"notimplemented", "notsupported", "unsupported", "methodnotallowed", "notallowed"}:
        return True
    detail = str(exc).lower()
    return any(marker in detail for marker in ("not implemented", "not supported", "unsupported operation"))


def _dedupe_bucket_names(bucket_names: Iterable[str] | None) -> list[str] | None:
    if bucket_names is None:
        return None
    return list(dict.fromkeys(name.strip() for name in bucket_names if name and name.strip()))


class BucketUsageStatsService(LongRunningS3ClientMixin):
    s3_user_agent_extra = "bucketreef-bucket-usage-stats"

    def __init__(self, session_factory: sessionmaker[Session] | Callable[[], Session] | None = None) -> None:
        self.session_factory = session_factory

    @staticmethod
    def _bucket_lease_scope(target: BucketUsageStatsResolvedTarget) -> str:
        endpoint_id = target.context.storage_endpoint_id
        if endpoint_id is None and target.context.storage_endpoint is not None:
            endpoint_id = target.context.storage_endpoint.id
        return f"endpoint:{endpoint_id}" if endpoint_id is not None else f"{target.scope_kind}:{target.scope_id}"

    def _acquire_bucket_lease(self, target: BucketUsageStatsResolvedTarget) -> OperationLeaseHandle | None:
        if self.session_factory is None:
            return None
        db = self.session_factory()
        try:
            return OperationLeaseService(db).acquire(
                bucket_usage_stats_bucket_operation_name(
                    self._bucket_lease_scope(target),
                    target.bucket_name,
                    bucket_tenant=target.bucket_tenant,
                ),
                ttl_seconds=BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
                lease_context={
                    "scope_kind": target.scope_kind,
                    "scope_id": target.scope_id,
                    "bucket_tenant": target.bucket_tenant,
                    "bucket_name": target.bucket_name,
                },
            )
        finally:
            db.close()

    def _release_bucket_lease(self, lease: OperationLeaseHandle) -> None:
        if self.session_factory is None:
            return
        db = self.session_factory()
        try:
            OperationLeaseService(db).release(lease)
        except Exception:  # noqa: BLE001
            logger.warning("Unable to release bucket usage statistics lease %s", lease.operation_name, exc_info=True)
        finally:
            db.close()

    def _iter_version_entries(
        self,
        client: Any,
        bucket_name: str,
        *,
        cancel_check: CancelCheck | None,
    ):
        paginator = client.get_paginator("list_object_versions")
        for page in paginator.paginate(Bucket=bucket_name):
            if cancel_check:
                cancel_check()
            for entry in page.get("Versions", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                yield ObjectVersionEntry(
                    key=key,
                    size=max(0, int(entry.get("Size") or 0)),
                    last_modified=entry.get("LastModified") if isinstance(entry.get("LastModified"), datetime) else None,
                    storage_class=entry.get("StorageClass") if isinstance(entry.get("StorageClass"), str) else None,
                    is_latest=bool(entry.get("IsLatest")),
                )
            for entry in page.get("DeleteMarkers", []) or []:
                key = entry.get("Key")
                if isinstance(key, str) and key:
                    yield {"delete_marker": True}

    def _iter_current_entries(
        self,
        client: Any,
        bucket_name: str,
        *,
        cancel_check: CancelCheck | None,
    ):
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket_name):
            if cancel_check:
                cancel_check()
            for entry in page.get("Contents", []) or []:
                key = entry.get("Key")
                if not isinstance(key, str) or not key:
                    continue
                yield ObjectVersionEntry(
                    key=key,
                    size=max(0, int(entry.get("Size") or 0)),
                    last_modified=entry.get("LastModified") if isinstance(entry.get("LastModified"), datetime) else None,
                    storage_class=entry.get("StorageClass") if isinstance(entry.get("StorageClass"), str) else None,
                    is_latest=True,
                )

    def calculate_bucket(
        self,
        target: BucketUsageStatsResolvedTarget,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketUsageStatsSnapshot:
        with self._open_client(target.context, bucket_name=target.s3_bucket_name) as client:
            calculated_at = utcnow()
            warnings: list[str] = []
            scan_mode: BucketUsageStatsScanMode = "versions"
            version_listing_available = True
            scan = BucketUsageScan(calculated_at)
            try:
                self._scan_version_entries(
                    client,
                    target,
                    scan,
                    progress_callback=progress_callback,
                    cancel_check=cancel_check,
                )
            except BucketUsageStatsCancelled:
                raise
            except (ClientError, BotoCoreError, RuntimeError) as exc:
                if not _is_version_listing_unsupported(exc):
                    raise RuntimeError(
                        f"Unable to list object versions for '{target.bucket_name}': {format_s3_error(exc)}"
                    ) from exc
                warnings.append(
                    "Version listing is unavailable for this endpoint. "
                    "Statistics were calculated from current objects only."
                )
                scan_mode = "current_only"
                version_listing_available = False
                scan = BucketUsageScan(calculated_at)
                try:
                    self._scan_current_entries(
                        client,
                        target,
                        scan,
                        progress_callback=progress_callback,
                        cancel_check=cancel_check,
                    )
                except BucketUsageStatsCancelled:
                    raise
                except (ClientError, BotoCoreError, RuntimeError) as fallback_exc:
                    raise RuntimeError(
                        f"Unable to list current objects for '{target.bucket_name}': {format_s3_error(fallback_exc)}"
                    ) from fallback_exc
            return scan.snapshot(
                target,
                scan_mode=scan_mode,
                version_listing_available=version_listing_available,
                warnings=warnings,
            )

    def _scan_version_entries(
        self,
        client: Any,
        target: BucketUsageStatsResolvedTarget,
        scan: BucketUsageScan,
        *,
        progress_callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> None:
        scan.emit_progress(
            target,
            progress_callback,
            "Listing object versions",
        )
        entries = self._iter_version_entries(
            client,
            target.s3_bucket_name,
            cancel_check=cancel_check,
        )
        for entry in entries:
            if cancel_check:
                cancel_check()
            if isinstance(entry, dict) and entry.get("delete_marker"):
                scan.add_delete_marker()
                continue
            scan.add_entry(entry)
            scan.emit_progress(target, progress_callback)

    def _scan_current_entries(
        self,
        client: Any,
        target: BucketUsageStatsResolvedTarget,
        scan: BucketUsageScan,
        *,
        progress_callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> None:
        scan.emit_progress(
            target,
            progress_callback,
            "Listing current objects",
        )
        entries = self._iter_current_entries(
            client,
            target.s3_bucket_name,
            cancel_check=cancel_check,
        )
        for entry in entries:
            if cancel_check:
                cancel_check()
            scan.add_entry(entry)
            scan.emit_progress(target, progress_callback)

    def get_latest(
        self,
        db: Session,
        *,
        scope_kind: str,
        scope_id: str,
        bucket_name: str,
        bucket_tenant: str = "",
    ) -> BucketUsageStatsSnapshot | None:
        row = db.scalars(
            select(BucketUsageStatsSnapshotRow).where(
                BucketUsageStatsSnapshotRow.scope_kind == scope_kind,
                BucketUsageStatsSnapshotRow.scope_id == scope_id,
                BucketUsageStatsSnapshotRow.bucket_tenant == bucket_tenant,
                BucketUsageStatsSnapshotRow.bucket_name == bucket_name,
            )
        ).first()
        return self._snapshot_from_row(row) if row else None

    def get_aggregate(
        self,
        db: Session,
        *,
        scope_kind: str,
        scope_id: str,
        scope_name: str | None = None,
        bucket_names: Iterable[str] | None = None,
    ) -> BucketUsageStatsAggregate:
        expected_bucket_names = _dedupe_bucket_names(bucket_names)
        expected_set = set(expected_bucket_names) if expected_bucket_names is not None else None
        rows = db.scalars(
            select(BucketUsageStatsSnapshotRow).where(
                BucketUsageStatsSnapshotRow.scope_kind == scope_kind,
                BucketUsageStatsSnapshotRow.scope_id == scope_id,
            )
        ).all()
        snapshots = [
            self._snapshot_from_row(row)
            for row in rows
            if expected_set is None or row.bucket_name in expected_set
        ]
        bucket_count = len(expected_bucket_names) if expected_bucket_names is not None else len(snapshots)
        buckets_with_snapshot = len({snapshot.bucket_name for snapshot in snapshots})
        return build_bucket_usage_aggregate(
            scope_kind=scope_kind,
            scope_id=scope_id,
            scope_name=scope_name,
            bucket_count=bucket_count,
            buckets_with_snapshot=buckets_with_snapshot,
            snapshots=snapshots,
        )

    def get_aggregate_for_targets(
        self,
        db: Session,
        *,
        scope_kind: str,
        scope_id: str,
        scope_name: str | None = None,
        targets: Iterable[BucketUsageStatsAggregateTarget],
        warnings: Iterable[str] | None = None,
        managed_account_count: int | None = None,
        accounts_with_listed_buckets: int | None = None,
        skipped_account_count: int | None = None,
    ) -> BucketUsageStatsAggregate:
        expected_targets = self._normalize_aggregate_targets(targets)
        rows_by_key = self._aggregate_snapshot_rows(db, expected_targets)
        snapshots = self._aggregate_target_snapshots(expected_targets, rows_by_key)

        return build_bucket_usage_aggregate(
            scope_kind=scope_kind,
            scope_id=scope_id,
            scope_name=scope_name,
            bucket_count=len(expected_targets),
            buckets_with_snapshot=len(snapshots),
            snapshots=snapshots,
            warnings=warnings,
            managed_account_count=managed_account_count,
            accounts_with_listed_buckets=accounts_with_listed_buckets,
            skipped_account_count=skipped_account_count,
        )

    @staticmethod
    def _normalize_aggregate_targets(
        targets: Iterable[BucketUsageStatsAggregateTarget],
    ) -> list[BucketUsageStatsAggregateTarget]:
        expected_targets: list[BucketUsageStatsAggregateTarget] = []
        seen_targets: set[tuple[str, str, str, str]] = set()
        for target in targets:
            normalized = BucketUsageStatsAggregateTarget(
                scope_kind=(target.scope_kind or "").strip(),
                scope_id=(target.scope_id or "").strip(),
                bucket_name=(target.bucket_name or "").strip(),
                bucket_tenant=(target.bucket_tenant or "").strip(),
            )
            key = (
                normalized.scope_kind,
                normalized.scope_id,
                normalized.bucket_tenant,
                normalized.bucket_name,
            )
            if not normalized.scope_kind or not normalized.scope_id or not normalized.bucket_name or key in seen_targets:
                continue
            seen_targets.add(key)
            expected_targets.append(normalized)
        return expected_targets

    @staticmethod
    def _aggregate_snapshot_rows(
        db: Session,
        targets: list[BucketUsageStatsAggregateTarget],
    ) -> dict[tuple[str, str, str, str], BucketUsageStatsSnapshotRow]:
        rows_by_key: dict[tuple[str, str, str, str], BucketUsageStatsSnapshotRow] = {}
        scopes = sorted({(target.scope_kind, target.scope_id) for target in targets})
        for target_scope_kind, target_scope_id in scopes:
            rows = db.scalars(
                select(BucketUsageStatsSnapshotRow).where(
                    BucketUsageStatsSnapshotRow.scope_kind == target_scope_kind,
                    BucketUsageStatsSnapshotRow.scope_id == target_scope_id,
                )
            ).all()
            for row in rows:
                rows_by_key[(row.scope_kind, row.scope_id, row.bucket_tenant, row.bucket_name)] = row
        return rows_by_key

    def _aggregate_target_snapshots(
        self,
        targets: list[BucketUsageStatsAggregateTarget],
        rows_by_key: dict[tuple[str, str, str, str], BucketUsageStatsSnapshotRow],
    ) -> list[BucketUsageStatsSnapshot]:
        snapshots: list[BucketUsageStatsSnapshot] = []
        for target in targets:
            row = rows_by_key.get(
                (target.scope_kind, target.scope_id, target.bucket_tenant, target.bucket_name)
            )
            if row is None:
                continue
            snapshots.append(self._snapshot_from_row(row))
        return snapshots

    def upsert_snapshot(self, db: Session, snapshot: BucketUsageStatsSnapshot) -> BucketUsageStatsSnapshot:
        row = db.scalars(
            select(BucketUsageStatsSnapshotRow).where(
                BucketUsageStatsSnapshotRow.scope_kind == snapshot.scope_kind,
                BucketUsageStatsSnapshotRow.scope_id == snapshot.scope_id,
                BucketUsageStatsSnapshotRow.bucket_tenant == snapshot.bucket_tenant,
                BucketUsageStatsSnapshotRow.bucket_name == snapshot.bucket_name,
            )
        ).first()
        if row is None:
            row = BucketUsageStatsSnapshotRow(
                scope_kind=snapshot.scope_kind,
                scope_id=snapshot.scope_id,
                bucket_tenant=snapshot.bucket_tenant,
                bucket_name=snapshot.bucket_name,
            )
            db.add(row)
        row.scope_name = snapshot.scope_name
        row.scan_mode = snapshot.scan_mode
        row.version_listing_available = bool(snapshot.version_listing_available)
        row.object_version_count = snapshot.object_version_count
        row.current_version_count = snapshot.current_version_count
        row.noncurrent_version_count = snapshot.noncurrent_version_count
        row.delete_marker_count = snapshot.delete_marker_count
        row.total_bytes = snapshot.total_bytes
        row.current_bytes = snapshot.current_bytes
        row.noncurrent_bytes = snapshot.noncurrent_bytes
        row.data_type_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.data_type_distribution])
        row.storage_class_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.storage_class_distribution])
        row.size_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.size_distribution])
        row.age_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.age_distribution])
        row.current_noncurrent_distribution_json = _json_dumps([entry.model_dump(mode="json") for entry in snapshot.current_vs_noncurrent])
        row.warnings_json = _json_dumps(snapshot.warnings) if snapshot.warnings else None
        row.calculated_at = snapshot.calculated_at
        db.commit()
        db.refresh(row)
        return self._snapshot_from_row(row)

    def calculate_and_persist(
        self,
        target: BucketUsageStatsResolvedTarget,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketUsageStatsSnapshot:
        snapshot = self.calculate_bucket(target, progress_callback=progress_callback, cancel_check=cancel_check)
        if self.session_factory is None:
            raise RuntimeError("Session factory is required to persist bucket usage statistics")
        db = self.session_factory()
        try:
            return self.upsert_snapshot(db, snapshot)
        finally:
            db.close()

    def run(
        self,
        targets: list[BucketUsageStatsResolvedTarget],
        options: BucketUsageStatsOptions,
        *,
        progress_callback: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> BucketUsageStatsResult:
        started_at = utcnow()
        if progress_callback:
            progress_callback(
                BucketUsageStatsProgress(
                    request_id=None,
                    stage="prepare",
                    bucket_name=None,
                    context_id=None,
                    context_name=None,
                    total_buckets=len(targets),
                    completed_buckets=0,
                    listed_versions=0,
                    listed_delete_markers=0,
                    total_bytes=0,
                    message="Preparing bucket usage statistics calculation",
                )
            )

        max_workers = max(1, min(options.parallelism, 32, len(targets) or 1))
        bucket_results, totals = self._collect_run_results(
            targets,
            max_workers=max_workers,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
        finished_at = utcnow()
        return BucketUsageStatsResult(
            status=totals.status(len(targets)),
            total_buckets=len(targets),
            completed_buckets=totals.completed_buckets,
            failed_buckets=totals.failed_buckets,
            skipped_buckets=totals.skipped_buckets,
            listed_versions=totals.listed_versions,
            listed_delete_markers=totals.listed_delete_markers,
            total_bytes=totals.total_bytes,
            started_at=started_at,
            finished_at=finished_at,
            buckets=sorted(bucket_results, key=lambda item: ((item.context_name or item.context_id or ""), item.bucket_name)),
        )

    def _run_target(
        self,
        target: BucketUsageStatsResolvedTarget,
        *,
        progress_callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> BucketUsageStatsBucketResult:
        started = monotonic()
        lease = self._acquire_bucket_lease(target)
        if self.session_factory is not None and lease is None:
            return BucketUsageStatsBucketResult(
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                status="skipped",
                snapshot=None,
                duration_seconds=monotonic() - started,
                message="Skipped because bucket usage statistics are already being calculated.",
            )
        try:
            snapshot = self.calculate_and_persist(
                target,
                progress_callback=progress_callback,
                cancel_check=cancel_check,
            )
            status_value: BucketUsageStatsStatus = "completed_with_warnings" if snapshot.warnings else "completed"
            return BucketUsageStatsBucketResult(
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                status=status_value,
                snapshot=snapshot,
                duration_seconds=monotonic() - started,
                message=snapshot.warnings[0] if snapshot.warnings else None,
            )
        except BucketUsageStatsCancelled:
            raise
        except Exception as exc:  # noqa: BLE001
            return BucketUsageStatsBucketResult(
                bucket_name=target.bucket_name,
                context_id=target.context_id,
                context_name=target.context_name,
                status="failed",
                snapshot=None,
                duration_seconds=monotonic() - started,
                message=format_s3_error(exc),
            )
        finally:
            if lease is not None:
                self._release_bucket_lease(lease)

    def _collect_run_results(
        self,
        targets: list[BucketUsageStatsResolvedTarget],
        *,
        max_workers: int,
        progress_callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> tuple[list[BucketUsageStatsBucketResult], _BucketUsageRunTotals]:
        bucket_results: list[BucketUsageStatsBucketResult] = []
        totals = _BucketUsageRunTotals()
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            pending = {
                executor.submit(
                    self._run_target,
                    target,
                    progress_callback=progress_callback,
                    cancel_check=cancel_check,
                ): target
                for target in targets
            }
            while pending:
                if cancel_check:
                    cancel_check()
                done, _ = wait(pending.keys(), timeout=0.2, return_when=FIRST_COMPLETED)
                for future in done:
                    pending.pop(future)
                    result = future.result()
                    bucket_results.append(result)
                    totals.include(result)
                    if progress_callback:
                        progress_callback(
                            BucketUsageStatsProgress(
                                request_id=None,
                                stage="completed",
                                bucket_name=result.bucket_name,
                                context_id=result.context_id,
                                context_name=result.context_name,
                                total_buckets=len(targets),
                                completed_buckets=totals.completed_buckets,
                                listed_versions=totals.listed_versions,
                                listed_delete_markers=totals.listed_delete_markers,
                                total_bytes=totals.total_bytes,
                                message=f"{totals.completed_buckets}/{len(targets)} buckets completed",
                            )
                        )
        return bucket_results, totals

    def _snapshot_from_row(self, row: BucketUsageStatsSnapshotRow) -> BucketUsageStatsSnapshot:
        return BucketUsageStatsSnapshot(
            scope_kind=row.scope_kind,
            scope_id=row.scope_id,
            scope_name=row.scope_name,
            bucket_name=row.bucket_name,
            bucket_tenant=row.bucket_tenant or "",
            scan_mode=row.scan_mode,
            version_listing_available=bool(row.version_listing_available),
            object_version_count=int(row.object_version_count or 0),
            current_version_count=int(row.current_version_count or 0),
            noncurrent_version_count=int(row.noncurrent_version_count or 0),
            delete_marker_count=int(row.delete_marker_count or 0),
            total_bytes=int(row.total_bytes or 0),
            current_bytes=int(row.current_bytes or 0),
            noncurrent_bytes=int(row.noncurrent_bytes or 0),
            data_type_distribution=_load_distribution_entries(row.data_type_distribution_json),
            storage_class_distribution=_load_distribution_entries(row.storage_class_distribution_json),
            size_distribution=_load_distribution_entries(row.size_distribution_json),
            age_distribution=_load_distribution_entries(row.age_distribution_json),
            current_vs_noncurrent=_load_distribution_entries(row.current_noncurrent_distribution_json),
            warnings=_load_warnings(row.warnings_json),
            calculated_at=row.calculated_at,
        )
