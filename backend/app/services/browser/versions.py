# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.models.browser import CleanupObjectVersionsPayload, CleanupObjectVersionsResponse
from app.services.object_listing_temp_store import TemporarySqliteStore
from app.services.object_version_cleanup_store import ObjectVersionCleanupStore
from app.services.s3_deletion import delete_objects
from app.services.s3_execution_context import S3ExecutionTarget

logger = logging.getLogger(__name__)


class BrowserVersionsMixin:
    def get_bucket_versioning(self, bucket_name: str, context: S3ExecutionTarget) -> Optional[str]:
        client = self._client(context)
        try:
            resp = client.get_bucket_versioning(Bucket=bucket_name)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to fetch versioning for bucket '{bucket_name}': {exc}") from exc
        return resp.get("Status")

    def _delete_version_batch(
        self,
        client,
        bucket_name: str,
        context: S3ExecutionTarget,
        batch: list[tuple[str, str]],
    ) -> None:
        with self._object_mutation(context, bucket_name):
            delete_objects(
                client,
                bucket_name,
                [{"Key": key, "VersionId": version_id} for key, version_id in batch],
            )

    def _cleanup_versions(
        self,
        client,
        bucket_name: str,
        context: S3ExecutionTarget,
        cleanup_store: ObjectVersionCleanupStore,
        *,
        keep_last_n: int | None,
        cutoff_ts: float | None,
    ) -> int:
        deleted = 0
        batch: list[tuple[str, str]] = []
        for row in cleanup_store.iter_cleanup_candidates(
            keep_last_n=keep_last_n,
            cutoff_ts=cutoff_ts,
        ):
            batch.append((str(row["key"]), str(row["version_id"])))
            if len(batch) < 1000:
                continue
            self._delete_version_batch(client, bucket_name, context, batch)
            cleanup_store.remove_versions(batch)
            deleted += len(batch)
            batch.clear()
        if batch:
            self._delete_version_batch(client, bucket_name, context, batch)
            cleanup_store.remove_versions(batch)
            deleted += len(batch)
        return deleted

    def _cleanup_orphan_markers(
        self,
        client,
        bucket_name: str,
        context: S3ExecutionTarget,
        cleanup_store: ObjectVersionCleanupStore,
    ) -> int:
        deleted = 0
        batch: list[tuple[str, str]] = []
        for row in cleanup_store.iter_orphan_markers():
            batch.append((str(row["key"]), str(row["version_id"])))
            if len(batch) < 1000:
                continue
            self._delete_version_batch(client, bucket_name, context, batch)
            deleted += len(batch)
            batch.clear()
        if batch:
            self._delete_version_batch(client, bucket_name, context, batch)
            deleted += len(batch)
        return deleted

    def cleanup_object_versions(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        payload: CleanupObjectVersionsPayload,
    ) -> CleanupObjectVersionsResponse:
        if not (payload.keep_last_n or payload.older_than_days or payload.delete_orphan_markers):
            raise ValueError("No cleanup criteria provided.")
        client = self._client(context, request_profile="long_running")
        prefix = payload.prefix or ""
        cutoff = None
        if payload.older_than_days:
            cutoff = datetime.now(timezone.utc) - timedelta(days=payload.older_than_days)

        try:
            with TemporarySqliteStore(prefix="bucketreef-browser-version-cleanup-") as store:
                cleanup_store = ObjectVersionCleanupStore(store.connection)
                scan_counts = cleanup_store.scan(client, bucket_name, prefix=prefix)
                scanned_versions = scan_counts.versions
                scanned_delete_markers = scan_counts.delete_markers
                logger.info(
                    "Indexed object versions for cleanup",
                    extra={
                        "bucket": bucket_name,
                        "prefix": prefix or None,
                        "versions": scanned_versions,
                        "delete_markers": scanned_delete_markers,
                    },
                )

                deleted_versions = 0
                if payload.keep_last_n is not None or cutoff:
                    cutoff_ts = cutoff.timestamp() if cutoff else None
                    deleted_versions = self._cleanup_versions(
                        client,
                        bucket_name,
                        context,
                        cleanup_store,
                        keep_last_n=payload.keep_last_n,
                        cutoff_ts=cutoff_ts,
                    )

                deleted_delete_markers = 0
                if payload.delete_orphan_markers:
                    deleted_delete_markers = self._cleanup_orphan_markers(
                        client,
                        bucket_name,
                        context,
                        cleanup_store,
                    )

            return CleanupObjectVersionsResponse(
                prefix=prefix or None,
                deleted_versions=deleted_versions,
                deleted_delete_markers=deleted_delete_markers,
                scanned_versions=scanned_versions,
                scanned_delete_markers=scanned_delete_markers,
            )
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to clean old versions for '{bucket_name}': {exc}") from exc
