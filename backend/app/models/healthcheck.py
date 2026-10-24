# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.models.base import ApiModel
from app.db import HealthCheckStatus


class EndpointHealthSummary(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int]
    http_status: Optional[int]
    error_message: Optional[str]
    check_mode: str
    check_target_url: Optional[str]


class EndpointHealthSummaryResponse(ApiModel):
    generated_at: str
    endpoints: list[EndpointHealthSummary]


class EndpointHealthRunResult(ApiModel):
    endpoint_id: int
    status: HealthCheckStatus
    latency_ms: Optional[int]
    http_status: Optional[int]
    error_message: Optional[str]
    check_mode: str


class EndpointHealthRunResponse(ApiModel):
    checked_at: str
    total: int
    notifications_created: int
    results: list[EndpointHealthRunResult]


class EndpointHealthPoint(ApiModel):
    timestamp: str
    status: HealthCheckStatus
    latency_ms: Optional[int]
    http_status: Optional[int]
    check_mode: str
    check_type: str
    scope: str


class EndpointHealthDailyPoint(ApiModel):
    day: str
    ok_count: int
    degraded_count: int
    down_count: int
    avg_latency_ms: Optional[int]
    p95_latency_ms: Optional[int]


class EndpointHealthSeries(ApiModel):
    endpoint_id: int
    window: str
    start: str
    end: str
    data_points: int
    check_mode: str
    check_target_url: Optional[str]
    check_type: str
    scope: str
    series: list[EndpointHealthPoint]
    daily: list[EndpointHealthDailyPoint]


class EndpointHealthIncident(ApiModel):
    start: str
    end: Optional[str]
    duration_minutes: Optional[int]
    status: HealthCheckStatus
    check_mode: str
    check_type: str
    scope: str


class EndpointHealthIncidentsResponse(ApiModel):
    endpoint_id: int
    window: str
    check_mode: str
    check_type: str
    scope: str
    incidents: list[EndpointHealthIncident]


class EndpointHealthRawCheck(ApiModel):
    checked_at: str
    status: HealthCheckStatus
    latency_ms: Optional[int]
    http_status: Optional[int]
    error_message: Optional[str]
    check_mode: str


class EndpointHealthRawChecksResponse(ApiModel):
    endpoint_id: int
    window: str
    start: str
    end: str
    page: int
    page_size: int
    total: int
    checks: list[EndpointHealthRawCheck]


class EndpointHealthTimelinePoint(ApiModel):
    timestamp: str
    end_timestamp: Optional[str]
    status: HealthCheckStatus
    latency_ms: Optional[int]
    reason: Optional[str]


class EndpointHealthOverviewEndpoint(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int]
    check_mode: str
    check_target_url: Optional[str]
    availability_pct: Optional[float]
    timeline: list[EndpointHealthTimelinePoint]


class EndpointHealthOverviewResponse(ApiModel):
    generated_at: str
    window: str
    start: str
    end: str
    endpoints: list[EndpointHealthOverviewEndpoint]


class EndpointHealthLatencyOverviewEndpoint(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int]
    check_mode: str
    check_target_url: Optional[str]
    min_latency_ms: Optional[int]
    avg_latency_ms: Optional[int]
    max_latency_ms: Optional[int]
    check_type: str
    scope: str


class EndpointHealthLatencyOverviewResponse(ApiModel):
    generated_at: str
    window: str
    start: str
    end: str
    endpoints: list[EndpointHealthLatencyOverviewEndpoint]


class EndpointHealthGlobalIncident(ApiModel):
    endpoint_id: int
    endpoint_name: str
    endpoint_url: Optional[str]
    status: HealthCheckStatus
    start: str
    end: Optional[str]
    duration_minutes: Optional[int]
    check_mode: str
    check_type: str
    scope: str


class EndpointHealthGlobalIncidentsResponse(ApiModel):
    window: str
    start: str
    end: str
    total: int
    incidents: list[EndpointHealthGlobalIncident]


class WorkspaceEndpointHealthEntry(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int]
    check_mode: str
    check_target_url: Optional[str]
    is_stale: bool


class WorkspaceEndpointIncidentEntry(ApiModel):
    endpoint_id: int
    endpoint_name: str
    endpoint_url: Optional[str]
    status: HealthCheckStatus
    start: str
    end: Optional[str]
    duration_minutes: Optional[int]
    check_mode: str
    ongoing: bool
    recent: bool


class WorkspaceEndpointHealthOverviewResponse(ApiModel):
    generated_at: str
    stale_after_seconds: int
    incident_highlight_minutes: int
    endpoint_count: int
    up_count: int
    degraded_count: int
    down_count: int
    unknown_count: int
    endpoints: list[WorkspaceEndpointHealthEntry]
    incidents: list[WorkspaceEndpointIncidentEntry]
