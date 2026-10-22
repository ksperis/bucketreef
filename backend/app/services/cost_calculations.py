# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional

from app.db import CostUsageDaily
from app.models.cost import (
    CostBreakdown,
    CostCoverage,
    CostStorageTotals,
    CostUsageTotals,
)


@dataclass
class CostPeriod:
    month: str
    start: date
    end: date
    days_in_month: int


@dataclass
class CostTotals:
    bytes_in: int
    bytes_out: int
    ops_total: int
    ops_breakdown: Optional[dict[str, int]]
    avg_storage_bytes: Optional[int]
    avg_storage_gb_month: Optional[float]
    total_objects: Optional[int]
    days_with_data: int
    storage_days_with_data: int = 0
    usage_days_with_data: int = 0


@dataclass(frozen=True)
class EffectiveCostModel:
    currency: str
    storage_gb_month_price: Decimal
    egress_gb_price: Decimal
    ingress_gb_price: Decimal
    requests_per_1000_price: Decimal
    pricing_source: str


def parse_cost_month(value: str) -> CostPeriod:
    text = (value or "").strip()
    try:
        period_start = datetime.strptime(text, "%Y-%m").date()
    except ValueError as exc:
        raise ValueError("Invalid month format, expected YYYY-MM") from exc
    year = period_start.year
    month = period_start.month
    if month == 12:
        period_end = date(year + 1, 1, 1)
    else:
        period_end = date(year, month + 1, 1)
    days_in_month = (period_end - period_start).days
    return CostPeriod(
        month=text,
        start=period_start,
        end=period_end,
        days_in_month=days_in_month,
    )


def _coverage(
    days_collected: int,
    days_in_month: int,
    *,
    storage_days_collected: Optional[int] = None,
    usage_days_collected: Optional[int] = None,
) -> CostCoverage:
    ratio = days_collected / days_in_month if days_in_month else 0
    return CostCoverage(
        days_collected=days_collected,
        days_in_month=days_in_month,
        coverage_ratio=ratio,
        storage_days_collected=storage_days_collected,
        usage_days_collected=usage_days_collected,
    )


def bytes_to_gb(value: Optional[int]) -> Optional[float]:
    if value is None:
        return None
    return float(value) / (1024**3)


def parse_ops_breakdown(raw: str) -> dict[str, int]:
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Cost operation breakdown must be a JSON object")
    if any(
        not isinstance(key, str)
        or not isinstance(value, int)
        or isinstance(value, bool)
        for key, value in payload.items()
    ):
        raise ValueError("Cost operation breakdown must map strings to integers")
    return payload


def merge_ops_breakdown(rows: Iterable[CostUsageDaily]) -> dict[str, int]:
    merged: dict[str, int] = defaultdict(int)
    for row in rows:
        if not row.ops_breakdown:
            continue
        for key, value in parse_ops_breakdown(row.ops_breakdown).items():
            merged[key] += value
    return dict(merged)


def compute_cost(
    model: Optional[EffectiveCostModel],
    totals: CostTotals,
) -> Optional[CostBreakdown]:
    if model is None:
        return None
    storage_gb_month = totals.avg_storage_gb_month
    egress_gb = bytes_to_gb(totals.bytes_out)
    ingress_gb = bytes_to_gb(totals.bytes_in)
    requests_k = totals.ops_total / 1000

    storage_cost = None
    if storage_gb_month is not None:
        storage_cost = float(model.storage_gb_month_price) * storage_gb_month
    egress_cost = float(model.egress_gb_price) * egress_gb
    ingress_cost = float(model.ingress_gb_price) * ingress_gb
    requests_cost = float(model.requests_per_1000_price) * requests_k

    components = [storage_cost, egress_cost, ingress_cost, requests_cost]
    has_component = any(value is not None for value in components)
    total_cost = (
        sum(value for value in components if value is not None)
        if has_component
        else None
    )

    return CostBreakdown(
        currency=model.currency,
        storage_cost=storage_cost,
        egress_cost=egress_cost,
        ingress_cost=ingress_cost,
        requests_cost=requests_cost,
        total_cost=total_cost,
        pricing_source=model.pricing_source,
    )


def build_usage_totals(totals: CostTotals) -> CostUsageTotals:
    return CostUsageTotals(
        bytes_in=totals.bytes_in,
        bytes_out=totals.bytes_out,
        ops_total=totals.ops_total,
        ops_breakdown=totals.ops_breakdown,
    )


def build_storage_totals(totals: CostTotals) -> CostStorageTotals:
    return CostStorageTotals(
        avg_bytes=totals.avg_storage_bytes,
        avg_gb_month=totals.avg_storage_gb_month,
        total_objects=totals.total_objects,
    )


def coverage_for_period(period: CostPeriod, totals: CostTotals) -> CostCoverage:
    return _coverage(
        totals.days_with_data,
        period.days_in_month,
        storage_days_collected=totals.storage_days_with_data,
        usage_days_collected=totals.usage_days_with_data,
    )


def sum_costs(costs: list[CostBreakdown]) -> Optional[CostBreakdown]:
    if not costs:
        return None
    sources = {cost.pricing_source for cost in costs if cost.pricing_source}

    def sum_component(name: str) -> Optional[float]:
        values = [
            getattr(cost, name)
            for cost in costs
            if getattr(cost, name) is not None
        ]
        return sum(values) if values else None

    return CostBreakdown(
        currency=costs[0].currency,
        storage_cost=sum_component("storage_cost"),
        egress_cost=sum_component("egress_cost"),
        ingress_cost=sum_component("ingress_cost"),
        requests_cost=sum_component("requests_cost"),
        total_cost=sum_component("total_cost"),
        pricing_source=next(iter(sources)) if len(sources) == 1 else "mixed",
    )
