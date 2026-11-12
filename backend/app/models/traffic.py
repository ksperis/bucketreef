# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.models.base import ApiModel


class TrafficSeriesPoint(ApiModel):
    timestamp: str
    bytes_in: int
    bytes_out: int
    ops: int
    success_ops: int


class TrafficTotals(ApiModel):
    bytes_in: int
    bytes_out: int
    ops: int
    success_ops: int
    success_rate: Optional[float]


class TrafficRankingMetrics(ApiModel):
    bytes_total: int
    bytes_in: int
    bytes_out: int
    ops: int
    success_ops: int
    success_ratio: Optional[float]


class TrafficBucketRanking(TrafficRankingMetrics):
    bucket: str


class TrafficUserRanking(TrafficRankingMetrics):
    user: str


class TrafficBreakdownMetrics(ApiModel):
    bytes_in: int
    bytes_out: int
    ops: int


class TrafficRequestBreakdown(TrafficBreakdownMetrics):
    group: str


class TrafficCategoryBreakdown(TrafficBreakdownMetrics):
    category: str


class TrafficStats(ApiModel):
    window: str
    start: str
    end: str
    resolution: str
    bucket_filter: Optional[str]
    data_points: int
    series: list[TrafficSeriesPoint]
    totals: TrafficTotals
    bucket_rankings: list[TrafficBucketRanking]
    user_rankings: list[TrafficUserRanking]
    request_breakdown: list[TrafficRequestBreakdown]
    category_breakdown: list[TrafficCategoryBreakdown]
