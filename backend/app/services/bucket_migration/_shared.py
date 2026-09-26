# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional

from app.core.sensitive_data import sanitize_error_detail, sanitize_log_text
from app.services.s3_execution_context import S3ExecutionTarget

_READ_ONLY_POLICY_SID = "BucketReefMigrationReadOnlyDeny"
_TARGET_WRITE_LOCK_POLICY_SID = "BucketReefMigrationTargetWriteLockDeny"
_SOURCE_COPY_GRANT_POLICY_SID = "BucketReefMigrationSourceCopyGrantAllow"
_MIGRATION_USER_AGENT_MARKER = "bucketreef-migration-worker"
_SYNC_PROGRESS_FLUSH_OBJECTS_THRESHOLD = 500
_SYNC_PROGRESS_FLUSH_INTERVAL_SECONDS = 10.0
_RUN_ACTIONS_WAIT_TIMEOUT_SECONDS = 5.0
_RUN_ACTIONS_CHUNK_SIZE_MULTIPLIER = 32
_ITEM_HEARTBEAT_PERSIST_INTERVAL_SECONDS = 10.0
_DIFF_CONTROL_CHECK_INTERVAL_OBJECTS = 5_000
_DB_ERROR_MESSAGE_MAX_CHARS = 16_384
_DB_EVENT_MESSAGE_MAX_CHARS = 4_096
_DB_EVENT_METADATA_MAX_CHARS = 65_536
_DB_EVENT_METADATA_MAX_DEPTH = 8
_DB_EVENT_METADATA_MAX_ITEMS = 100
_RUNNABLE_MIGRATION_STATUSES = ("queued", "running", "pause_requested", "cancel_requested")
_FINAL_MIGRATION_STATUSES = (
    "completed",
    "completed_with_errors",
    "failed",
    "canceled",
    "rolled_back",
)


class _WorkerLeaseLostError(RuntimeError):
    """Raised when a worker loses ownership of a migration lease."""


class _MigrationControlRequested(RuntimeError):
    """Raised when a long-running scan must stop for pause/cancel."""

    def __init__(self, state: str) -> None:
        super().__init__(state)
        self.state = state


@dataclass
class _ResolvedContext:
    context_id: str
    account: S3ExecutionTarget
    endpoint: Optional[str]
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool


@dataclass
class _SyncDiff:
    source_count: int
    target_count: int
    matched_count: int
    different_count: int
    only_source_count: int
    only_target_count: int
    sample: dict[str, Any]


@dataclass(frozen=True)
class _BucketObjectEntry:
    key: str
    size: int
    etag: Optional[str]


@dataclass(frozen=True)
class _BucketDiffEntry:
    kind: str
    key: str
    source_size: int
    target_size: int
    source_etag: Optional[str]
    target_etag: Optional[str]
    compare_by: str


@dataclass(frozen=True)
class _BucketVersionEntry:
    key: str
    version_id: str
    is_delete_marker: bool
    is_latest: bool
    last_modified: Optional[datetime]
    size: int
    etag: Optional[str]
    storage_class: Optional[str]
    order_index: int


@dataclass
class _VersionReplayWatermarkBuilder:
    latest_dt: Optional[datetime] = None
    tie_entries: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class _VersionedObjectDetails:
    size: int
    etag: Optional[str]
    compare_by: str
    checksums: dict[str, str]
    content_type: Optional[str]
    cache_control: Optional[str]
    content_disposition: Optional[str]
    content_encoding: Optional[str]
    content_language: Optional[str]
    expires: Optional[str]
    storage_class: Optional[str]
    metadata: dict[str, str]
    tags: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class _VersionTimelineDiffKey:
    key: str
    source_version_id: Optional[str]
    target_version_id: Optional[str]


@dataclass(frozen=True)
class _VersionAwareDiff:
    source_count: int
    target_count: int
    matched_count: int
    different_count: int
    only_source_count: int
    only_target_count: int
    sample: dict[str, Any]
    size_only_pairs: tuple[_VersionTimelineDiffKey, ...] = ()


@dataclass(frozen=True)
class _VersionTimelineComparison:
    equal: bool
    first_difference: Optional[dict[str, Any]]
    size_only_pairs: tuple[_VersionTimelineDiffKey, ...] = ()


_VERSION_CHECKSUM_FIELDS = (
    "ChecksumSHA256",
    "ChecksumCRC32C",
    "ChecksumCRC32",
    "ChecksumSHA1",
)


@dataclass(frozen=True)
class _MigrationRuntimeLimits:
    parallelism_default: int
    parallelism_max: int
    max_active_per_endpoint: int


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)


def _json_loads(value: Optional[str]) -> Any:
    if value is None:
        return None
    return json.loads(value)


def _truncate_db_text(value: Any, *, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    text = "" if value is None else sanitize_log_text(value)
    if len(text) <= max_chars:
        return text
    omitted = len(text) - max_chars
    suffix = f"... [truncated {omitted} chars]"
    if len(suffix) >= max_chars:
        return suffix[:max_chars]
    return text[: max_chars - len(suffix)] + suffix


def _truncate_optional_db_text(value: Optional[str], *, max_chars: int) -> Optional[str]:
    if value is None:
        return None
    return _truncate_db_text(value, max_chars=max_chars)


def _sanitize_event_metadata(value: Any, *, depth: int = 0) -> Any:
    if depth >= _DB_EVENT_METADATA_MAX_DEPTH:
        return _truncate_db_text(value, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _truncate_db_text(value, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)
    if isinstance(value, dict):
        safe_dict: dict[str, Any] = {}
        total_items = len(value)
        for index, (key, nested_value) in enumerate(value.items()):
            if index >= _DB_EVENT_METADATA_MAX_ITEMS:
                safe_dict["__truncated_items__"] = total_items - _DB_EVENT_METADATA_MAX_ITEMS
                break
            safe_key = _truncate_db_text(key, max_chars=256)
            safe_dict[safe_key] = _sanitize_event_metadata(nested_value, depth=depth + 1)
        return safe_dict
    if isinstance(value, (list, tuple, set)):
        entries = list(value)
        safe_entries = [
            _sanitize_event_metadata(entry, depth=depth + 1)
            for entry in entries[:_DB_EVENT_METADATA_MAX_ITEMS]
        ]
        if len(entries) > _DB_EVENT_METADATA_MAX_ITEMS:
            safe_entries.append(
                f"[truncated {len(entries) - _DB_EVENT_METADATA_MAX_ITEMS} additional item(s)]"
            )
        return safe_entries
    return _truncate_db_text(value, max_chars=_DB_EVENT_MESSAGE_MAX_CHARS)


def _serialize_event_metadata(metadata: Optional[dict[str, Any]]) -> Optional[str]:
    if metadata is None:
        return None
    serialized = _json_dumps(metadata)
    if len(serialized) <= _DB_EVENT_METADATA_MAX_CHARS:
        return serialized
    fallback_payload = {
        "truncated": True,
        "original_length": len(serialized),
        "preview": _truncate_db_text(serialized, max_chars=1024),
    }
    return _json_dumps(fallback_payload)
