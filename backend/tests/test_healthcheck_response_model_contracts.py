# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.healthcheck import (
    EndpointHealthDailyPoint,
    EndpointHealthGlobalIncident,
    EndpointHealthGlobalIncidentsResponse,
    EndpointHealthIncident,
    EndpointHealthIncidentsResponse,
    EndpointHealthLatencyOverviewEndpoint,
    EndpointHealthOverviewEndpoint,
    EndpointHealthPoint,
    EndpointHealthRawCheck,
    EndpointHealthSeries,
    EndpointHealthSummary,
    EndpointHealthTimelinePoint,
    WorkspaceEndpointHealthEntry,
    WorkspaceEndpointHealthOverviewResponse,
    WorkspaceEndpointIncidentEntry,
)


def _required(model_type) -> set[str]:
    return set(model_type.model_json_schema()["required"])


def test_healthcheck_response_models_require_complete_canonical_payloads() -> None:
    assert _required(EndpointHealthSummary) == {
        "endpoint_id",
        "name",
        "endpoint_url",
        "status",
        "checked_at",
        "latency_ms",
        "http_status",
        "error_message",
        "check_mode",
        "check_target_url",
    }
    assert _required(EndpointHealthPoint) == {
        "timestamp",
        "status",
        "latency_ms",
        "http_status",
        "check_mode",
        "check_type",
        "scope",
    }
    assert _required(EndpointHealthDailyPoint) == {
        "day",
        "ok_count",
        "degraded_count",
        "down_count",
        "avg_latency_ms",
        "p95_latency_ms",
    }
    assert _required(EndpointHealthSeries) == {
        "endpoint_id",
        "window",
        "start",
        "end",
        "data_points",
        "check_mode",
        "check_target_url",
        "check_type",
        "scope",
        "series",
        "daily",
    }
    assert _required(EndpointHealthIncident) == {
        "start",
        "end",
        "duration_minutes",
        "status",
        "check_mode",
        "check_type",
        "scope",
    }
    assert _required(EndpointHealthIncidentsResponse) == {
        "endpoint_id",
        "window",
        "check_mode",
        "check_type",
        "scope",
        "incidents",
    }
    assert _required(EndpointHealthRawCheck) == {
        "checked_at",
        "status",
        "latency_ms",
        "http_status",
        "error_message",
        "check_mode",
    }
    assert _required(EndpointHealthTimelinePoint) == {
        "timestamp",
        "end_timestamp",
        "status",
        "latency_ms",
        "reason",
    }
    assert _required(EndpointHealthOverviewEndpoint) == {
        "endpoint_id",
        "name",
        "endpoint_url",
        "status",
        "checked_at",
        "latency_ms",
        "check_mode",
        "check_target_url",
        "availability_pct",
        "timeline",
    }
    assert _required(EndpointHealthLatencyOverviewEndpoint) == {
        "endpoint_id",
        "name",
        "endpoint_url",
        "status",
        "checked_at",
        "latency_ms",
        "check_mode",
        "check_target_url",
        "min_latency_ms",
        "avg_latency_ms",
        "max_latency_ms",
        "check_type",
        "scope",
    }
    assert _required(EndpointHealthGlobalIncident) == {
        "endpoint_id",
        "endpoint_name",
        "endpoint_url",
        "status",
        "start",
        "end",
        "duration_minutes",
        "check_mode",
        "check_type",
        "scope",
    }
    assert _required(EndpointHealthGlobalIncidentsResponse) == {
        "window",
        "start",
        "end",
        "total",
        "incidents",
    }
    assert _required(WorkspaceEndpointHealthEntry) == {
        "endpoint_id",
        "name",
        "endpoint_url",
        "status",
        "checked_at",
        "latency_ms",
        "check_mode",
        "check_target_url",
        "is_stale",
    }
    assert _required(WorkspaceEndpointIncidentEntry) == {
        "endpoint_id",
        "endpoint_name",
        "endpoint_url",
        "status",
        "start",
        "end",
        "duration_minutes",
        "check_mode",
        "ongoing",
        "recent",
    }
    assert _required(WorkspaceEndpointHealthOverviewResponse) == {
        "generated_at",
        "stale_after_seconds",
        "incident_highlight_minutes",
        "endpoint_count",
        "up_count",
        "degraded_count",
        "down_count",
        "unknown_count",
        "endpoints",
        "incidents",
    }
