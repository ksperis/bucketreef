# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import csv
import io
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from app.core.domain_errors import CostSubjectNotFoundError
from app.db import CostStorageDaily, CostUsageDaily
from app.models.cost import (
    CostAnalyticsConcentration,
    CostAnalyticsEndpoint,
    CostAnalyticsResponse,
    CostDailySeriesPoint,
    CostHistoryPoint,
    CostSubjectListingRequest,
    CostSubjectSortBy,
    CostSubjectDetail,
    CostSubjectSummary,
    CostSubjectsResponse,
    CostSummary,
)
from app.services.cost_calculations import (
    CostPeriod,
    CostTotals,
    build_storage_totals,
    build_usage_totals,
    bytes_to_gb,
    compute_cost,
    coverage_for_period,
    merge_ops_breakdown,
    parse_cost_month,
    sum_costs,
)
from app.services.cost_query_service import CostQueryService


def _history_periods(period: CostPeriod, months: int) -> list[CostPeriod]:
    if months < 1:
        return []
    selected_month_index = period.start.year * 12 + period.start.month - 1
    return [
        parse_cost_month(f"{year:04d}-{zero_based_month + 1:02d}")
        for month_index in range(
            selected_month_index - months + 1,
            selected_month_index + 1,
        )
        for year, zero_based_month in [divmod(month_index, 12)]
    ]


_COST_SUBJECT_SORT_VALUE_GETTERS = {
    "cost": lambda entry: (
        entry.cost.total_cost
        if entry.cost and entry.cost.total_cost is not None
        else -1
    ),
    "egress": lambda entry: entry.usage.bytes_out,
    "ingress": lambda entry: entry.usage.bytes_in,
    "storage": lambda entry: entry.storage.avg_bytes or 0,
    "requests": lambda entry: entry.usage.ops_total,
    "endpoint": lambda entry: entry.storage_endpoint_name.casefold(),
    "name": lambda entry: entry.name.casefold(),
}


class CostService:
    def __init__(self, db: Session) -> None:
        self.queries = CostQueryService(db)

    @staticmethod
    def _normalize_subject_type(subject_type: str) -> str:
        normalized = subject_type.lower().strip()
        if normalized not in {"all", "account", "s3_user"}:
            raise ValueError("Invalid subject type")
        return normalized

    def summary(self, month: str, endpoint_id: Optional[int]) -> CostSummary:
        period = parse_cost_month(month)
        return self._summary_for_period(period, endpoint_id, "all")

    @staticmethod
    def _subject_matches_search(
        entry: CostSubjectSummary,
        search_value: str,
    ) -> bool:
        return any(
            search_value in candidate.casefold()
            for candidate in (
                entry.name,
                entry.rgw_identifier or "",
                entry.storage_endpoint_name,
            )
        )

    @staticmethod
    def _subject_sort_value(entry: CostSubjectSummary, sort_by: CostSubjectSortBy):
        getter = _COST_SUBJECT_SORT_VALUE_GETTERS[sort_by]
        return getter(entry)

    def _summary_for_period(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> CostSummary:
        subject_type = self._normalize_subject_type(subject_type)
        aggregate_type = None if subject_type == "all" else subject_type
        totals = self.queries.aggregate_totals(
            period,
            endpoint_id=endpoint_id,
            subject_type=aggregate_type,
        )
        if endpoint_id is not None:
            cost = compute_cost(self.queries.resolve_model(endpoint_id), totals)
        else:
            endpoint_ids = self.queries.endpoint_ids_with_data(
                period,
                subject_type=aggregate_type,
            )
            if endpoint_ids:
                costs = [
                    computed
                    for current_endpoint_id in endpoint_ids
                    if (
                        computed := compute_cost(
                            self.queries.resolve_model(current_endpoint_id),
                            self.queries.aggregate_totals(
                                period,
                                endpoint_id=current_endpoint_id,
                                subject_type=aggregate_type,
                            ),
                        )
                    )
                    is not None
                ]
                cost = sum_costs(costs)
            else:
                cost = compute_cost(self.queries.resolve_model(None), totals)
        return CostSummary(
            month=period.month,
            storage_endpoint_id=endpoint_id,
            usage=build_usage_totals(totals),
            storage=build_storage_totals(totals),
            coverage=coverage_for_period(period, totals),
            cost=cost,
        )

    def list_subjects(
        self,
        query: CostSubjectListingRequest,
    ) -> CostSubjectsResponse:
        period = parse_cost_month(query.month)
        items = self._all_subject_summaries(period, query.endpoint_id, query.subject_type)

        search_value = (query.search or "").strip().casefold()
        if search_value:
            items = [
                entry
                for entry in items
                if self._subject_matches_search(entry, search_value)
            ]
        items.sort(
            key=lambda entry: self._subject_sort_value(entry, query.sort_by),
            reverse=query.sort_dir == "desc",
        )
        total = len(items)
        start = (query.page - 1) * query.page_size
        end = start + query.page_size
        return CostSubjectsResponse(
            items=items[start:end],
            total=total,
            page=query.page,
            page_size=query.page_size,
            has_next=end < total,
        )

    def subject_detail(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> CostSubjectDetail:
        period = parse_cost_month(month)
        subject_type = self._normalize_subject_type(subject_type)
        subject = self.queries.subject(endpoint_id, subject_type, subject_id)
        if not subject:
            raise CostSubjectNotFoundError("Subject not found")

        usage_rows = self.queries.usage_rows_for_subject(
            period,
            endpoint_id,
            subject_type,
            subject_id,
        )
        storage_rows = self.queries.storage_rows_for_subject(
            period,
            endpoint_id,
            subject_type,
            subject_id,
        )
        totals = self._subject_totals_from_rows(usage_rows, storage_rows)
        daily = self._subject_daily_series(usage_rows, storage_rows)

        return CostSubjectDetail(
            month=period.month,
            storage_endpoint_id=endpoint_id,
            storage_endpoint_name=subject.storage_endpoint.name,
            subject_type=subject_type,
            subject_id=subject_id,
            name=subject.name,
            rgw_identifier=subject.rgw_user_uid,
            daily=daily,
            usage=build_usage_totals(totals),
            storage=build_storage_totals(totals),
            coverage=coverage_for_period(period, totals),
            cost=compute_cost(self.queries.resolve_model(endpoint_id), totals),
        )

    @staticmethod
    def _subject_daily_series(
        usage_rows: Iterable[CostUsageDaily],
        storage_rows: Iterable[CostStorageDaily],
    ) -> list[CostDailySeriesPoint]:
        daily_map: dict[str, dict[str, Optional[int]]] = {}
        for row in storage_rows:
            key = row.day.isoformat()
            daily_map.setdefault(
                key,
                {"storage_bytes": None, "bytes_in": None, "bytes_out": None, "ops_total": None},
            )["storage_bytes"] = row.total_bytes
        for row in usage_rows:
            key = row.day.isoformat()
            entry = daily_map.setdefault(
                key,
                {"storage_bytes": None, "bytes_in": None, "bytes_out": None, "ops_total": None},
            )
            entry["bytes_in"] = row.bytes_in
            entry["bytes_out"] = row.bytes_out
            entry["ops_total"] = row.ops_total

        return [
            CostDailySeriesPoint(day=day, **values)
            for day, values in sorted(daily_map.items())
        ]

    def subject_history(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
        months: int = 12,
    ) -> list[CostHistoryPoint]:
        period = parse_cost_month(month)
        subject_type = self._normalize_subject_type(subject_type)
        if subject_type == "all":
            raise ValueError("Invalid subject type")

        model = self.queries.resolve_model(endpoint_id)
        history: list[CostHistoryPoint] = []
        for history_period in _history_periods(period, months):
            usage_rows = self.queries.usage_rows_for_subject(
                history_period,
                endpoint_id,
                subject_type,
                subject_id,
            )
            storage_rows = self.queries.storage_rows_for_subject(
                history_period,
                endpoint_id,
                subject_type,
                subject_id,
            )
            totals = self._subject_totals_from_rows(usage_rows, storage_rows)
            history.append(
                CostHistoryPoint(
                    month=history_period.month,
                    coverage=coverage_for_period(history_period, totals),
                    cost=compute_cost(model, totals),
                )
            )
        return history

    @staticmethod
    def _subject_totals_from_rows(
        usage_rows: Iterable[CostUsageDaily],
        storage_rows: Iterable[CostStorageDaily],
    ) -> CostTotals:
        usage_rows = list(usage_rows)
        storage_rows = list(storage_rows)
        total_storage_bytes = sum(row.total_bytes for row in storage_rows)
        days_with_storage = len(storage_rows)
        avg_storage_bytes = int(total_storage_bytes / days_with_storage) if days_with_storage else None
        usage_days = len({row.day for row in usage_rows})
        return CostTotals(
            bytes_in=sum(row.bytes_in for row in usage_rows),
            bytes_out=sum(row.bytes_out for row in usage_rows),
            ops_total=sum(row.ops_total for row in usage_rows),
            ops_breakdown=merge_ops_breakdown(usage_rows) if usage_rows else None,
            avg_storage_bytes=avg_storage_bytes,
            avg_storage_gb_month=bytes_to_gb(avg_storage_bytes) if avg_storage_bytes is not None else None,
            total_objects=(sum(row.total_objects for row in storage_rows) if storage_rows else None),
            days_with_data=max(days_with_storage, usage_days),
            storage_days_with_data=days_with_storage,
            usage_days_with_data=usage_days,
        )

    def export_csv(
        self,
        month: str,
        endpoint_id: Optional[int],
        subject_type: str = "all",
    ) -> tuple[str, str]:
        period = parse_cost_month(month)
        subject_type = self._normalize_subject_type(subject_type)
        rows = self._all_subject_summaries(period, endpoint_id, subject_type)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "storage_endpoint_id",
                "storage_endpoint_name",
                "subject_type",
                "subject_id",
                "name",
                "rgw_identifier",
                "avg_storage_gb_month",
                "egress_gb",
                "ingress_gb",
                "requests_k",
                "total_cost",
                "currency",
            ]
        )
        for item in rows:
            writer.writerow(
                [
                    item.storage_endpoint_id,
                    item.storage_endpoint_name,
                    item.subject_type,
                    item.subject_id,
                    item.name,
                    item.rgw_identifier or "",
                    f"{item.storage.avg_gb_month:.6f}" if item.storage.avg_gb_month is not None else "",
                    f"{bytes_to_gb(item.usage.bytes_out):.6f}" if item.usage.bytes_out is not None else "",
                    f"{bytes_to_gb(item.usage.bytes_in):.6f}" if item.usage.bytes_in is not None else "",
                    f"{item.usage.ops_total / 1000:.6f}" if item.usage.ops_total is not None else "",
                    f"{item.cost.total_cost:.6f}" if item.cost and item.cost.total_cost is not None else "",
                    item.cost.currency if item.cost and item.cost.currency else "",
                ]
            )
        endpoint_suffix = f"endpoint-{endpoint_id}" if endpoint_id is not None else "all-endpoints"
        filename = f"cost-{period.month}-{endpoint_suffix}.csv"
        return filename, output.getvalue()

    def analytics(
        self,
        month: str,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> CostAnalyticsResponse:
        period = parse_cost_month(month)
        subject_type = self._normalize_subject_type(subject_type)
        summary = self._summary_for_period(period, endpoint_id, subject_type)
        by_endpoint = self._analytics_by_endpoint(period, endpoint_id, subject_type)
        ranked_subjects = self._ranked_analytics_subjects(period, endpoint_id, subject_type)

        return CostAnalyticsResponse(
            month=period.month,
            storage_endpoint_id=endpoint_id,
            subject_type=subject_type,
            summary=summary,
            by_endpoint=by_endpoint,
            top_subjects=ranked_subjects[:10],
            concentration=self._analytics_concentration(ranked_subjects),
            history=self._analytics_history(period, endpoint_id, subject_type),
        )

    def _analytics_by_endpoint(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> list[CostAnalyticsEndpoint]:
        aggregate_type = None if subject_type == "all" else subject_type
        entries: list[CostAnalyticsEndpoint] = []
        for endpoint in self.queries.ceph_endpoints(endpoint_id):
            current_endpoint_id = int(endpoint.id)
            totals = self.queries.aggregate_totals(
                period,
                endpoint_id=current_endpoint_id,
                subject_type=aggregate_type,
            )
            if totals.days_with_data == 0:
                continue
            entries.append(
                CostAnalyticsEndpoint(
                    storage_endpoint_id=current_endpoint_id,
                    storage_endpoint_name=endpoint.name,
                    coverage=coverage_for_period(period, totals),
                    cost=compute_cost(
                        self.queries.resolve_model(current_endpoint_id),
                        totals,
                    ),
                )
            )
        entries.sort(
            key=lambda item: item.cost.total_cost if item.cost and item.cost.total_cost is not None else -1,
            reverse=True,
        )
        return entries

    def _ranked_analytics_subjects(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> list[CostSubjectSummary]:
        entries = [
            item
            for item in self._all_subject_summaries(period, endpoint_id, subject_type)
            if item.cost
            and item.cost.total_cost is not None
            and (
                item.storage.avg_bytes is not None
                or item.usage.bytes_in > 0
                or item.usage.bytes_out > 0
                or item.usage.ops_total > 0
            )
        ]
        entries.sort(
            key=lambda item: item.cost.total_cost if item.cost and item.cost.total_cost is not None else -1,
            reverse=True,
        )
        return entries

    @staticmethod
    def _analytics_concentration(
        ranked_subjects: list[CostSubjectSummary],
    ) -> CostAnalyticsConcentration:
        subject_total_cost = sum(float(item.cost.total_cost or 0) for item in ranked_subjects if item.cost)
        top_five_cost = sum(float(item.cost.total_cost or 0) for item in ranked_subjects[:5] if item.cost)
        return CostAnalyticsConcentration(
            top_five_cost=top_five_cost,
            other_cost=max(subject_total_cost - top_five_cost, 0),
            top_five_ratio=top_five_cost / subject_total_cost if subject_total_cost > 0 else 0,
        )

    def _analytics_history(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> list[CostHistoryPoint]:
        history: list[CostHistoryPoint] = []
        for history_period in _history_periods(period, 12):
            history_summary = self._summary_for_period(history_period, endpoint_id, subject_type)
            history.append(
                CostHistoryPoint(
                    month=history_period.month,
                    coverage=history_summary.coverage,
                    cost=history_summary.cost,
                )
            )
        return history

    def _all_subject_summaries(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> list[CostSubjectSummary]:
        subject_types = ("account", "s3_user") if subject_type == "all" else (subject_type,)
        return [
            item
            for endpoint in self.queries.ceph_endpoints(endpoint_id)
            for current_subject_type in subject_types
            for item in self._subject_summaries(
                period,
                int(endpoint.id),
                current_subject_type,
                endpoint.name,
            )
        ]

    def _subject_summaries(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
        endpoint_name: Optional[str] = None,
    ) -> list[CostSubjectSummary]:
        usage_by_subject = self.queries.usage_totals_by_subject(
            period,
            endpoint_id,
            subject_type,
        )
        storage_by_subject = self.queries.storage_totals_by_subject(
            period,
            endpoint_id,
            subject_type,
        )
        items: list[CostSubjectSummary] = []
        for subject in self.queries.load_subjects(endpoint_id, subject_type):
            subject_id = int(subject.id)
            usage = usage_by_subject.get(subject_id, (0, 0, 0))
            storage = storage_by_subject.get(subject_id, (None, None, 0))
            totals = CostTotals(
                bytes_in=usage[0],
                bytes_out=usage[1],
                ops_total=usage[2],
                ops_breakdown=None,
                avg_storage_bytes=storage[0],
                avg_storage_gb_month=bytes_to_gb(storage[0]) if storage[0] is not None else None,
                total_objects=storage[1],
                days_with_data=storage[2] or 0,
            )
            items.append(
                CostSubjectSummary(
                    storage_endpoint_id=endpoint_id,
                    storage_endpoint_name=endpoint_name or subject.storage_endpoint.name,
                    subject_type=subject_type,
                    subject_id=subject_id,
                    name=subject.name,
                    rgw_identifier=subject.rgw_user_uid,
                    storage=build_storage_totals(totals),
                    usage=build_usage_totals(totals),
                    cost=compute_cost(
                        self.queries.resolve_model(endpoint_id),
                        totals,
                    ),
                )
            )
        return items
