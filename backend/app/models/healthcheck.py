# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional

from app.models.base import ApiModel
from app.core.domain_enums import HealthCheckMode, HealthCheckStatus, HealthWindow


HealthCheckType = Literal["availability"]
HealthCheckScope = Literal["endpoint"]


class EndpointHealthCurrentStatus(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: str
    status: HealthCheckStatus
    checked_at: str
    latency_ms: Optional[int]
    check_mode: HealthCheckMode
    check_target_url: Optional[str]


class EndpointHealthSummary(EndpointHealthCurrentStatus):
    http_status: Optional[int]
    error_message: Optional[str]


class EndpointHealthSummaryResponse(ApiModel):
    generated_at: str
    endpoints: list[EndpointHealthSummary]


class EndpointHealthCheckResult(ApiModel):
    status: HealthCheckStatus
    latency_ms: Optional[int]
    http_status: Optional[int]
    error_message: Optional[str]
    check_mode: HealthCheckMode


class EndpointHealthRunResult(EndpointHealthCheckResult):
    endpoint_id: int


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
    check_mode: HealthCheckMode
    check_type: HealthCheckType
    scope: HealthCheckScope


class EndpointHealthDailyPoint(ApiModel):
    day: str
    ok_count: int
    degraded_count: int
    down_count: int
    avg_latency_ms: Optional[int]
    p95_latency_ms: Optional[int]


class EndpointHealthSeries(ApiModel):
    endpoint_id: int
    window: HealthWindow
    start: str
    end: str
    data_points: int
    check_mode: HealthCheckMode
    check_target_url: Optional[str]
    check_type: HealthCheckType
    scope: HealthCheckScope
    series: list[EndpointHealthPoint]
    daily: list[EndpointHealthDailyPoint]


class EndpointHealthIncident(ApiModel):
    start: str
    end: Optional[str]
    duration_minutes: Optional[int]
    status: HealthCheckStatus
    check_mode: HealthCheckMode
    check_type: HealthCheckType
    scope: HealthCheckScope


class EndpointHealthIncidentsResponse(ApiModel):
    endpoint_id: int
    window: HealthWindow
    check_mode: HealthCheckMode
    check_type: HealthCheckType
    scope: HealthCheckScope
    incidents: list[EndpointHealthIncident]


class EndpointHealthRawCheck(EndpointHealthCheckResult):
    checked_at: str


class EndpointHealthRawChecksResponse(ApiModel):
    endpoint_id: int
    window: HealthWindow
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


class EndpointHealthOverviewEndpoint(EndpointHealthCurrentStatus):
    availability_pct: Optional[float]
    timeline: list[EndpointHealthTimelinePoint]


class EndpointHealthOverviewResponseFields(ApiModel):
    generated_at: str
    window: HealthWindow
    start: str
    end: str


class EndpointHealthOverviewResponse(EndpointHealthOverviewResponseFields):
    endpoints: list[EndpointHealthOverviewEndpoint]


class EndpointHealthLatencyOverviewEndpoint(EndpointHealthCurrentStatus):
    min_latency_ms: Optional[int]
    avg_latency_ms: Optional[int]
    max_latency_ms: Optional[int]
    check_type: HealthCheckType
    scope: HealthCheckScope


class EndpointHealthLatencyOverviewResponse(EndpointHealthOverviewResponseFields):
    endpoints: list[EndpointHealthLatencyOverviewEndpoint]


class EndpointHealthIncidentEntry(ApiModel):
    endpoint_id: int
    endpoint_name: str
    endpoint_url: Optional[str]
    status: HealthCheckStatus
    start: str
    end: Optional[str]
    duration_minutes: Optional[int]
    check_mode: HealthCheckMode


class EndpointHealthGlobalIncident(EndpointHealthIncidentEntry):
    check_type: HealthCheckType
    scope: HealthCheckScope


class EndpointHealthGlobalIncidentsResponse(ApiModel):
    window: HealthWindow
    start: str
    end: str
    total: int
    incidents: list[EndpointHealthGlobalIncident]


class WorkspaceEndpointHealthEntry(EndpointHealthCurrentStatus):
    is_stale: bool


class WorkspaceEndpointIncidentEntry(EndpointHealthIncidentEntry):
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
