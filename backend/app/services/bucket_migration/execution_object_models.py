# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


VERSION_CHECKSUM_FIELDS = (
    "ChecksumSHA256",
    "ChecksumCRC32C",
    "ChecksumCRC32",
    "ChecksumSHA1",
)


@dataclass
class SyncDiff:
    source_count: int
    target_count: int
    matched_count: int
    different_count: int
    only_source_count: int
    only_target_count: int
    sample: dict[str, Any]


@dataclass(frozen=True)
class BucketObjectEntry:
    key: str
    size: int
    etag: Optional[str]


@dataclass(frozen=True)
class BucketDiffEntry:
    kind: str
    key: str
    source_size: int
    target_size: int
    source_etag: Optional[str]
    target_etag: Optional[str]
    compare_by: str


@dataclass(frozen=True)
class BucketVersionEntry:
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
class VersionReplayWatermarkBuilder:
    latest_dt: Optional[datetime] = None
    tie_entries: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class VersionedObjectDetails:
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
class VersionTimelineDiffKey:
    key: str
    source_version_id: Optional[str]
    target_version_id: Optional[str]


@dataclass(frozen=True)
class VersionAwareDiff:
    source_count: int
    target_count: int
    matched_count: int
    different_count: int
    only_source_count: int
    only_target_count: int
    sample: dict[str, Any]
    size_only_pairs: tuple[VersionTimelineDiffKey, ...] = ()


@dataclass(frozen=True)
class VersionTimelineComparison:
    equal: bool
    first_difference: Optional[dict[str, Any]]
    size_only_pairs: tuple[VersionTimelineDiffKey, ...] = ()
