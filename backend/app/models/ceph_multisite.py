# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Generic, Literal, TypeVar

from pydantic import Field

from app.models.base import ApiModel

Availability = Literal[
    "available", "not_observed", "not_applicable", "not_found", "denied",
    "unsupported", "unavailable", "misconfigured",
]
Family = Literal["metadata", "data", "bucket-index"]
Operation = Literal[
    "period", "realm", "metadata_status", "data_status", "bucket_status",
    "bucket_instance", "bilog_info", "metadata_log", "data_log", "bilog",
    "metadata_shard_info", "data_shard_info",
]
T = TypeVar("T")


class Provenance(ApiModel):
    endpoint_id: int
    realm_id: str | None = None
    local_zone_id: str | None = None
    source_zone_id: str | None = None
    operation: Operation
    http_status: int | None = None
    duration_ms: float = 0
    collection_id: str


class Observation(ApiModel, Generic[T]):
    availability: Availability
    data: T | None = None
    collected_at: str
    last_success_at: str | None = None
    stale: bool = False
    provenance: Provenance
    reason_code: str | None = None


class EndpointReference(ApiModel):
    id: int
    name: str
    diagnostic: bool


class Zone(ApiModel):
    id: str
    name: str
    zonegroup_id: str
    zonegroup_name: str
    metadata_master: bool
    read_only: bool | None = None
    sync_from_all: bool | None = None
    sync_from: list[str] = Field(default_factory=list)
    policy_requires_confirmation: bool = False
    endpoints: list[EndpointReference] = Field(default_factory=list)
    diagnostic_endpoint_id: int | None = None


class Period(ApiModel):
    id: str
    realm_id: str
    epoch: str | None
    realm_epoch: str | None
    master_zone: str | None
    zones: list[Zone]
    details: dict[str, Any]


class Topology(ApiModel):
    period: Observation[Period]
    realm: Observation[dict[str, Any]] | None = None
    association_valid: bool
    association_reason: str | None = None


class Shard(ApiModel):
    shard_id: int
    phase: str
    raw_status: str | int | None
    marker: str | None
    timestamp: str | None
    details: dict[str, Any]


class SyncStatus(ApiModel):
    family: Family
    phase: str
    raw_status: str | None
    expected_shards: int | None = None
    period: str | None = None
    realm_epoch: str | None = None
    instance_id: str | None = None
    generation: str | None = None
    shards: list[Shard]
    details: dict[str, Any]


class Flow(ApiModel):
    destination_endpoint_id: int
    destination_zone_id: str
    source_zone_id: str
    status: Observation[SyncStatus]
    scope_requires_confirmation: bool = False


class Overview(ApiModel):
    topology: Topology
    metadata: list[Flow]
    data: list[Flow]
    uncollected: list[str]
    next_offset: int | None = None


class BucketIdentity(ApiModel):
    name: str
    tenant: str | None
    instance_id: str


class BilogInfo(ApiModel):
    latest_gen: str | None
    oldest_gen: str | None
    generations: list[dict[str, Any]]
    details: dict[str, Any]


class BucketDiagnostic(ApiModel):
    source: Observation[BucketIdentity]
    destination: Observation[BucketIdentity]
    status: Observation[SyncStatus]
    bilog: Observation[BilogInfo]


class LogPage(ApiModel):
    family: Family
    scope: dict[str, Any]
    entries: list[dict[str, Any]]
    next_cursor: str | None
    truncated: bool
    last_update: str | None = None
    next_log: dict[str, Any] | None = None


class Capabilities(ApiModel):
    topology: Topology
    metadata: Observation[SyncStatus]
    data: list[Flow]
    bucket_index: Observation[BilogInfo]
