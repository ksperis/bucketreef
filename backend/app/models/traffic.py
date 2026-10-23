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


class TrafficBucketRanking(ApiModel):
    bucket: str
    bytes_total: int
    bytes_in: int
    bytes_out: int
    ops: int
    success_ops: int
    success_ratio: Optional[float]


class TrafficUserRanking(ApiModel):
    user: str
    bytes_total: int
    bytes_in: int
    bytes_out: int
    ops: int
    success_ops: int
    success_ratio: Optional[float]


class TrafficRequestBreakdown(ApiModel):
    group: str
    bytes_in: int
    bytes_out: int
    ops: int


class TrafficCategoryBreakdown(ApiModel):
    category: str
    bytes_in: int
    bytes_out: int
    ops: int


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
