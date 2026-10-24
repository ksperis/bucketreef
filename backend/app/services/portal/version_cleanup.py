# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Iterator, TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError

from app.db import User
from app.models.portal_versions import (
    PortalStorageSpaceVersionCleanupStage,
    PortalStorageSpaceVersionCleanupProgress,
    PortalStorageSpaceVersionCleanupResult,
    portal_storage_space_version_cleanup_confirmation_phrase,
)
from app.services.bucket_purge_service import BucketPurgeCancelled
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.object_version_cleanup_store import ObjectVersionCleanupStore, ObjectVersionScanCounts
from app.services import s3_deletion
from app.services.portal.exceptions import PortalForbiddenError, PortalNotFoundError

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


PortalVersionCleanupProgressCallback = Callable[[PortalStorageSpaceVersionCleanupProgress], None]
PortalVersionCleanupCancelCheck = Callable[[], None]


@dataclass(frozen=True)
class PortalStorageSpaceVersionCleanupTarget:
    client: Any
    bucket_name: str
    storage_space_id: str
    storage_space_name: str


@dataclass
class _PortalVersionCleanupRun:
    target: PortalStorageSpaceVersionCleanupTarget
    progress_callback: PortalVersionCleanupProgressCallback | None
    cancel_check: PortalVersionCleanupCancelCheck | None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    scanned_versions: int = 0
    scanned_delete_markers: int = 0
    delete_candidates: int = 0
    deleted_versions: int = 0
    deleted_delete_markers: int = 0
    bytes_freed: int = 0

    def check_cancel(self) -> None:
        if self.cancel_check:
            self.cancel_check()

    def emit(
        self,
        stage: PortalStorageSpaceVersionCleanupStage,
        message: str | None = None,
        *,
        total_candidates_final: bool = False,
    ) -> None:
        if self.progress_callback is None:
            return
        self.progress_callback(
            PortalStorageSpaceVersionCleanupProgress(
                request_id=None,
                stage=stage,
                storage_space_id=self.target.storage_space_id,
                storage_space_name=self.target.storage_space_name,
                scanned_versions=self.scanned_versions,
                scanned_delete_markers=self.scanned_delete_markers,
                delete_candidates=self.delete_candidates,
                deleted_versions=self.deleted_versions,
                deleted_delete_markers=self.deleted_delete_markers,
                bytes_freed=self.bytes_freed,
                total_candidates_final=total_candidates_final,
                message=message,
            )
        )

    def update_scan_progress(self, counts: ObjectVersionScanCounts) -> None:
        self.scanned_versions = counts.versions
        self.scanned_delete_markers = counts.delete_markers
        self.emit("list", "Scanning historical versions and delete markers...")

    def delete_versions_batch(
        self,
        cleanup_store: ObjectVersionCleanupStore,
        batch: list[tuple[str, str, int]],
    ) -> None:
        self.check_cancel()
        items = [
            {"Key": key, "VersionId": version_id}
            for key, version_id, _size in batch
        ]
        s3_deletion.delete_objects_count(
            self.target.client,
            self.target.bucket_name,
            items,
        )
        cleanup_store.remove_versions(
            [(key, version_id) for key, version_id, _size in batch]
        )
        self.deleted_versions += len(batch)
        self.bytes_freed += sum(size for _key, _version_id, size in batch)
        self.emit("delete", "Deleting historical versions...")

    def delete_markers_batch(self, batch: list[tuple[str, str]]) -> None:
        self.check_cancel()
        items = [{"Key": key, "VersionId": version_id} for key, version_id in batch]
        s3_deletion.delete_objects_count(
            self.target.client,
            self.target.bucket_name,
            items,
        )
        self.deleted_delete_markers += len(batch)
        self.emit(
            "delete",
            "Deleting orphan delete markers...",
            total_candidates_final=True,
        )

    def result(self) -> PortalStorageSpaceVersionCleanupResult:
        return PortalStorageSpaceVersionCleanupResult(
            status="completed",
            storage_space_id=self.target.storage_space_id,
            storage_space_name=self.target.storage_space_name,
            scanned_versions=self.scanned_versions,
            scanned_delete_markers=self.scanned_delete_markers,
            deleted_versions=self.deleted_versions,
            deleted_delete_markers=self.deleted_delete_markers,
            bytes_freed=self.bytes_freed,
            started_at=self.started_at,
            finished_at=datetime.now(timezone.utc),
        )


def _version_batches(
    cleanup_store: ObjectVersionCleanupStore,
    *,
    batch_size: int = 1000,
) -> Iterator[list[tuple[str, str, int]]]:
    batch: list[tuple[str, str, int]] = []
    for row in cleanup_store.iter_noncurrent_versions():
        batch.append(
            (
                str(row["key"]),
                str(row["version_id"]),
                int(row["size_bytes"] or 0),
            )
        )
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


def _marker_batches(
    cleanup_store: ObjectVersionCleanupStore,
    *,
    batch_size: int = 1000,
) -> Iterator[list[tuple[str, str]]]:
    batch: list[tuple[str, str]] = []
    for row in cleanup_store.iter_orphan_markers():
        batch.append((str(row["key"]), str(row["version_id"])))
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch


class PortalStorageSpaceVersionCleanupMixin:
    def prepare_storage_space_version_cleanup(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        confirmation: str,
    ) -> PortalStorageSpaceVersionCleanupTarget:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        portal_settings = self.get_effective_portal_settings(access.account)
        if not portal_settings.storage_space_version_cleanup_enabled:
            raise PortalForbiddenError("Storage Space history cleanup is not allowed for this account.")
        self._require_storage_space_full_content_access(user, access, bucket_name)
        self._require_storage_space_active(access.account, bucket_name)
        metadata = self._storage_space_metadata(access.account, bucket_name)
        storage_space_name = self._display_storage_space_name(bucket_name, metadata)
        expected_confirmation = portal_storage_space_version_cleanup_confirmation_phrase(storage_space_name)
        if confirmation != expected_confirmation:
            raise ValueError(f"Confirmation must be exactly '{expected_confirmation}'.")
        return PortalStorageSpaceVersionCleanupTarget(
            client=self._portal_object_client(user, access.account, request_profile="long_running"),
            bucket_name=bucket_name,
            storage_space_id=space_id,
            storage_space_name=storage_space_name,
        )

    def run_storage_space_version_cleanup(
        self,
        target: PortalStorageSpaceVersionCleanupTarget,
        *,
        progress_callback: PortalVersionCleanupProgressCallback | None = None,
        cancel_check: PortalVersionCleanupCancelCheck | None = None,
    ) -> PortalStorageSpaceVersionCleanupResult:
        run = _PortalVersionCleanupRun(
            target=target,
            progress_callback=progress_callback,
            cancel_check=cancel_check,
        )
        run.emit("prepare", "Preparing Storage Space history cleanup...")
        try:
            with TemporarySqliteStore(prefix="bucketreef-portal-version-cleanup-") as store:
                cleanup_store = ObjectVersionCleanupStore(store.connection)
                run.emit("list", "Scanning historical versions and delete markers...")
                scan_counts = cleanup_store.scan(
                    target.client,
                    target.bucket_name,
                    before_page=run.check_cancel,
                    after_page=run.update_scan_progress,
                )
                run.scanned_versions = scan_counts.versions
                run.scanned_delete_markers = scan_counts.delete_markers
                run.delete_candidates = cleanup_store.count_noncurrent_versions()
                run.emit("delete", "Deleting historical versions...")

                for batch in _version_batches(cleanup_store):
                    run.delete_versions_batch(cleanup_store, batch)

                run.delete_candidates += cleanup_store.count_orphan_markers()
                run.emit(
                    "delete",
                    "Deleting orphan delete markers...",
                    total_candidates_final=True,
                )

                for batch in _marker_batches(cleanup_store):
                    run.delete_markers_batch(batch)

            run.emit(
                "completed",
                "Storage Space history cleanup completed.",
                total_candidates_final=True,
            )
            return run.result()
        except BucketPurgeCancelled:
            raise
        except (ClientError, BotoCoreError, RuntimeError) as exc:
            raise RuntimeError(
                f"Unable to clean historical versions for Storage Space '{target.storage_space_name}': {exc}"
            ) from exc
