# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.models.base import ApiModel
from app.models.traffic import TrafficSeriesPoint


class AdminDashboardEndpoint(ApiModel):
    endpoint_id: int
    name: str


class AdminDashboardScope(ApiModel):
    endpoints: list[AdminDashboardEndpoint]


class AdminDashboardCoverageIssue(ApiModel):
    endpoint_id: int
    name: str
    endpoint_url: Optional[str]
    reason: str


class AdminDashboardCoverage(ApiModel):
    eligible_count: int
    contributing_count: int
    complete_count: int
    issues: list[AdminDashboardCoverageIssue]


class AdminDashboardCache(ApiModel):
    hit: bool
    expires_at: str


class AdminDashboardStorageTotals(ApiModel):
    bucket_count: Optional[int]
    object_count: Optional[int]
    used_bytes: Optional[int]


class AdminDashboardMeasurementCoverage(ApiModel):
    contributing_count: int
    complete_count: int


class AdminDashboardStorageMeasurements(ApiModel):
    bucket_count: AdminDashboardMeasurementCoverage
    object_count: AdminDashboardMeasurementCoverage
    used_bytes: AdminDashboardMeasurementCoverage


class AdminDashboardStorage(ApiModel):
    cache: AdminDashboardCache
    generated_at: str
    storage_totals: AdminDashboardStorageTotals
    coverage: AdminDashboardCoverage
    measurements: AdminDashboardStorageMeasurements


class AdminDashboardTrafficTotals(ApiModel):
    bytes_in: Optional[int]
    bytes_out: Optional[int]
    ops: Optional[int]
    success_ops: Optional[int]
    success_rate: Optional[float]


class AdminDashboardTraffic(ApiModel):
    cache: AdminDashboardCache
    window: str
    start: str
    end: str
    resolution: str
    data_points: int
    series: list[TrafficSeriesPoint]
    totals: AdminDashboardTrafficTotals
    coverage: AdminDashboardCoverage
