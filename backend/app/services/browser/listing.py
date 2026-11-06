# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import base64
import hashlib
import json
import logging
from typing import Callable, Optional

from botocore.exceptions import BotoCoreError, ClientError

from app.core.domain_errors import BrowserListingCursorError
from app.models.browser import (
    BrowserObjectListingRequest,
    BrowserObjectVersion,
    ListBrowserObjectsResponse,
    ListObjectVersionsResponse,
)
from app.services.s3_execution_context import S3ExecutionTarget

from .cache import OBJECT_LIST_CACHE, OBJECT_SORT_SNAPSHOT_CACHE
from .default_listing import DefaultObjectListingLoader, DefaultObjectScanOptions
from .sorted_listing import (
    SortedObjectScanOptions,
    SortedObjectSnapshot,
    SortedObjectSnapshotBuilder,
)

logger = logging.getLogger(__name__)


def _sorted_snapshot_signature(parts: tuple[object, ...]) -> str:
    serialized = json.dumps(parts, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _encode_sorted_cursor(*, prefixes_offset: int, objects_offset: int, signature: str) -> str:
    payload = {
        "v": 1,
        "mode": "sorted",
        "po": max(0, int(prefixes_offset)),
        "oo": max(0, int(objects_offset)),
        "sig": signature,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def _decode_sorted_cursor(token: Optional[str]) -> Optional[dict[str, object]]:
    if not token:
        return None
    padded = token + "=" * (-len(token) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("mode") != "sorted" or payload.get("v") != 1:
        return None
    return payload


class BrowserListingMixin:
    @staticmethod
    def _object_list_cache_key(
        context_cache_key: str,
        bucket_name: str,
        request: BrowserObjectListingRequest,
    ) -> tuple[object, ...]:
        return (
            context_cache_key,
            bucket_name,
            request.prefix,
            request.continuation_token or "",
            request.max_keys,
            request.query or "",
            request.query_exact,
            request.query_case_sensitive,
            request.resolved_item_type,
            request.storage_class or "",
            request.recursive,
            request.include_folder_markers,
        )

    @staticmethod
    def _object_sort_snapshot_cache_key(
        context_cache_key: str,
        bucket_name: str,
        request: BrowserObjectListingRequest,
    ) -> tuple[object, ...]:
        return (
            context_cache_key,
            bucket_name,
            request.prefix,
            request.query or "",
            request.query_exact,
            request.query_case_sensitive,
            request.resolved_item_type,
            request.storage_class or "",
            request.recursive,
            request.include_folder_markers,
            request.sort_by,
            request.sort_dir,
        )

    @staticmethod
    def _build_query_matcher(request: BrowserObjectListingRequest) -> Callable[[str], bool]:
        query_value_raw = request.query or ""
        query_value = query_value_raw if request.query_case_sensitive else query_value_raw.lower()

        def matches_query(value: str) -> bool:
            if not query_value:
                return True
            relative = value
            if request.prefix and relative.startswith(request.prefix):
                relative = relative[len(request.prefix):]
            if relative.endswith("/"):
                relative = relative[:-1]
            comparable_value = relative if request.query_case_sensitive else relative.lower()
            if request.query_exact:
                return comparable_value == query_value
            return query_value in comparable_value

        return matches_query

    def _list_objects_default_order(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        request: BrowserObjectListingRequest,
    ) -> ListBrowserObjectsResponse:
        context_cache_key = self._context_cache_key(context)
        object_cache_key = self._object_list_cache_key(
            context_cache_key,
            bucket_name,
            request,
        )
        cached = OBJECT_LIST_CACHE.get(object_cache_key)
        if cached is not None:
            logger.debug("Browser object cache hit: context=%s bucket=%s", context_cache_key, bucket_name)
            return cached.model_copy(deep=True)
        result = DefaultObjectListingLoader(
            client=self._bucket_client(context, bucket_name),
            options=DefaultObjectScanOptions(
                bucket_name=bucket_name,
                prefix=request.prefix,
                max_keys=request.max_keys,
                item_type=request.resolved_item_type,
                storage_class=request.storage_class,
                recursive=request.recursive,
                include_folder_markers=request.include_folder_markers,
            ),
            matches_query=self._build_query_matcher(request),
            clean_etag=self._clean_etag,
        ).load(
            continuation_token=request.continuation_token,
            filtered=(
                request.query is not None
                or request.resolved_item_type != "all"
                or request.storage_class is not None
                or request.recursive
            ),
        )
        OBJECT_LIST_CACHE.set(object_cache_key, result.model_copy(deep=True))
        logger.debug("Browser object cache miss: context=%s bucket=%s", context_cache_key, bucket_name)
        return result

    def _scan_sorted_object_snapshot(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        request: BrowserObjectListingRequest,
    ) -> SortedObjectSnapshot:
        context_cache_key = self._context_cache_key(context)
        snapshot_cache_key = self._object_sort_snapshot_cache_key(
            context_cache_key,
            bucket_name,
            request,
        )
        cached = OBJECT_SORT_SNAPSHOT_CACHE.get(snapshot_cache_key)
        if cached is not None:
            return cached

        snapshot = SortedObjectSnapshotBuilder(
            client=self._bucket_client(context, bucket_name),
            options=SortedObjectScanOptions(
                bucket_name=bucket_name,
                prefix=request.prefix,
                item_type=request.resolved_item_type,
                storage_class=request.storage_class,
                recursive=request.recursive,
                include_folder_markers=request.include_folder_markers,
                sort_by=request.sort_by,
                sort_dir=request.sort_dir,
            ),
            matches_query=self._build_query_matcher(request),
            clean_etag=self._clean_etag,
            normalize_datetime=self._normalize_datetime_value,
        ).build()
        OBJECT_SORT_SNAPSHOT_CACHE.set(snapshot_cache_key, snapshot)
        return snapshot

    def list_objects(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        request: BrowserObjectListingRequest,
    ) -> ListBrowserObjectsResponse:
        if request.force_refresh:
            self.invalidate_object_list_cache_for_context(context, bucket_name)
        if request.sort_by == "name" and request.sort_dir == "asc":
            return self._list_objects_default_order(
                bucket_name,
                context,
                request,
            )

        return self._list_objects_sorted_order(
            bucket_name,
            context,
            request,
        )

    def _list_objects_sorted_order(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        request: BrowserObjectListingRequest,
    ) -> ListBrowserObjectsResponse:
        snapshot = self._scan_sorted_object_snapshot(
            bucket_name,
            context,
            request,
        )
        context_cache_key = self._context_cache_key(context)
        snapshot_signature = _sorted_snapshot_signature(
            self._object_sort_snapshot_cache_key(
                context_cache_key,
                bucket_name,
                request,
            )
        )
        prefixes_offset, objects_offset = self._sorted_cursor_offsets(
            snapshot,
            continuation_token=request.continuation_token,
            snapshot_signature=snapshot_signature,
        )
        return self._sorted_page_response(
            snapshot,
            request,
            prefixes_offset=prefixes_offset,
            objects_offset=objects_offset,
            snapshot_signature=snapshot_signature,
        )

    @staticmethod
    def _sorted_cursor_offsets(
        snapshot: SortedObjectSnapshot,
        *,
        continuation_token: Optional[str],
        snapshot_signature: str,
    ) -> tuple[int, int]:
        cursor_payload = _decode_sorted_cursor(continuation_token)
        prefixes_offset = 0
        objects_offset = 0
        if cursor_payload and cursor_payload.get("sig") != snapshot_signature:
            raise BrowserListingCursorError("Listing filters changed; restart pagination")
        if cursor_payload and cursor_payload.get("sig") == snapshot_signature:
            prefixes_offset = max(0, int(cursor_payload.get("po") or 0))
            objects_offset = max(0, int(cursor_payload.get("oo") or 0))
        prefixes_offset = min(prefixes_offset, snapshot.prefix_count)
        objects_offset = min(objects_offset, snapshot.object_count)
        return prefixes_offset, objects_offset

    @staticmethod
    def _sorted_page_response(
        snapshot: SortedObjectSnapshot,
        request: BrowserObjectListingRequest,
        *,
        prefixes_offset: int,
        objects_offset: int,
        snapshot_signature: str,
    ) -> ListBrowserObjectsResponse:
        prefixes = snapshot.fetch_prefixes(prefixes_offset, request.max_keys)
        remaining = request.max_keys - len(prefixes)
        objects = snapshot.fetch_objects(objects_offset, remaining)
        next_prefixes_offset = prefixes_offset + len(prefixes)
        next_objects_offset = objects_offset + len(objects)
        has_more = next_prefixes_offset < snapshot.prefix_count or next_objects_offset < snapshot.object_count
        next_token = None
        if has_more:
            next_token = _encode_sorted_cursor(
                prefixes_offset=next_prefixes_offset,
                objects_offset=next_objects_offset,
                signature=snapshot_signature,
            )
        return ListBrowserObjectsResponse(
            prefix=request.prefix,
            objects=objects,
            prefixes=list(prefixes),
            is_truncated=has_more,
            next_continuation_token=next_token,
        )

    @staticmethod
    def _object_versions_request(
        bucket_name: str,
        *,
        prefix: str,
        delimiter: Optional[str],
        filter_key: Optional[str],
        key_marker: Optional[str],
        version_id_marker: Optional[str],
        max_keys: int,
    ) -> dict[str, object]:
        kwargs: dict[str, object] = {
            "Bucket": bucket_name,
            "Prefix": filter_key if filter_key is not None else prefix,
            "MaxKeys": max_keys,
        }
        if delimiter and filter_key is None:
            kwargs["Delimiter"] = delimiter
        if key_marker:
            kwargs["KeyMarker"] = key_marker
        if version_id_marker:
            kwargs["VersionIdMarker"] = version_id_marker
        return kwargs

    def _project_object_versions(
        self,
        entries: list[dict],
        *,
        filter_key: Optional[str],
    ) -> list[BrowserObjectVersion]:
        versions: list[BrowserObjectVersion] = []
        for entry in entries:
            entry_key = entry.get("Key")
            if not entry_key or (filter_key is not None and entry_key != filter_key):
                continue
            versions.append(
                BrowserObjectVersion(
                    key=entry_key,
                    version_id=entry.get("VersionId"),
                    is_latest=bool(entry.get("IsLatest")),
                    is_delete_marker=False,
                    last_modified=entry.get("LastModified"),
                    size=int(entry.get("Size") or 0),
                    etag=self._clean_etag(entry.get("ETag")),
                    storage_class=entry.get("StorageClass"),
                )
            )
        return versions

    @staticmethod
    def _project_delete_markers(
        entries: list[dict],
        *,
        filter_key: Optional[str],
    ) -> list[BrowserObjectVersion]:
        markers: list[BrowserObjectVersion] = []
        for entry in entries:
            entry_key = entry.get("Key")
            if not entry_key or (filter_key is not None and entry_key != filter_key):
                continue
            markers.append(
                BrowserObjectVersion(
                    key=entry_key,
                    version_id=entry.get("VersionId"),
                    is_latest=bool(entry.get("IsLatest")),
                    is_delete_marker=True,
                    last_modified=entry.get("LastModified"),
                    size=None,
                    etag=None,
                    storage_class=None,
                )
            )
        return markers

    def list_object_versions(
        self,
        bucket_name: str,
        context: S3ExecutionTarget,
        prefix: str = "",
        delimiter: Optional[str] = None,
        key: Optional[str] = None,
        key_marker: Optional[str] = None,
        version_id_marker: Optional[str] = None,
        max_keys: int = 1000,
    ) -> ListObjectVersionsResponse:
        client = self._client(context)
        filter_key = key
        kwargs = self._object_versions_request(
            bucket_name,
            prefix=prefix,
            delimiter=delimiter,
            filter_key=filter_key,
            key_marker=key_marker,
            version_id_marker=version_id_marker,
            max_keys=max_keys,
        )
        try:
            resp = client.list_object_versions(**kwargs)
        except (ClientError, BotoCoreError) as exc:
            raise RuntimeError(f"Unable to list object versions for '{bucket_name}': {exc}") from exc
        response_prefix = filter_key if filter_key is not None else (prefix or None)
        return ListObjectVersionsResponse(
            prefix=response_prefix,
            common_prefixes=[
                str(entry["Prefix"])
                for entry in resp.get("CommonPrefixes", [])
                if entry.get("Prefix")
            ],
            versions=self._project_object_versions(resp.get("Versions", []), filter_key=filter_key),
            delete_markers=self._project_delete_markers(resp.get("DeleteMarkers", []), filter_key=filter_key),
            is_truncated=bool(resp.get("IsTruncated")),
            key_marker=resp.get("KeyMarker"),
            version_id_marker=resp.get("VersionIdMarker"),
            next_key_marker=resp.get("NextKeyMarker"),
            next_version_id_marker=resp.get("NextVersionIdMarker"),
        )
