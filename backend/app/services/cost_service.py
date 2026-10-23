# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import csv
import io
from typing import Iterable, Optional, TypeAlias

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import CostSubjectNotFoundError
from app.db import (
    CostEndpointOverride,
    CostModel,
    CostStorageDaily,
    CostUsageDaily,
    S3Account,
    S3User,
    StorageEndpoint,
    StorageProvider,
)
from app.models.cost import (
    CostAnalyticsConcentration,
    CostAnalyticsEndpoint,
    CostAnalyticsHistoryPoint,
    CostAnalyticsResponse,
    CostDailySeriesPoint,
    CostSubjectDetail,
    CostSubjectHistoryPoint,
    CostSubjectSummary,
    CostSubjectsResponse,
    CostSummary,
)
from app.services.cost_calculations import (
    CostPeriod,
    CostTotals,
    EffectiveCostModel,
    build_storage_totals,
    build_usage_totals,
    bytes_to_gb,
    compute_cost,
    coverage_for_period,
    merge_ops_breakdown,
    parse_cost_month,
    sum_costs,
)

CostSubject: TypeAlias = S3Account | S3User


def _resolve_cost_model(db: Session, endpoint_id: Optional[int]) -> Optional[EffectiveCostModel]:
    global_model = db.get(CostModel, 1)
    if global_model is None:
        return None
    override = None
    if endpoint_id is not None:
        override = db.scalar(
            select(CostEndpointOverride).where(
                CostEndpointOverride.storage_endpoint_id == endpoint_id
            )
        )
    rates = override or global_model
    return EffectiveCostModel(
        currency=global_model.currency,
        storage_gb_month_price=rates.storage_gb_month_price,
        egress_gb_price=rates.egress_gb_price,
        ingress_gb_price=rates.ingress_gb_price,
        requests_per_1000_price=rates.requests_per_1000_price,
        pricing_source="endpoint_override" if override is not None else "global",
    )



class CostService:
    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _normalize_subject_type(subject_type: str) -> str:
        normalized = subject_type.lower().strip()
        if normalized not in {"all", "account", "s3_user"}:
            raise ValueError("Invalid subject type")
        return normalized

    def summary(self, month: str, endpoint_id: Optional[int]) -> CostSummary:
        period = parse_cost_month(month)
        return self._summary_for_period(period, endpoint_id, "all")

    def _summary_for_period(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> CostSummary:
        subject_type = self._normalize_subject_type(subject_type)
        aggregate_type = None if subject_type == "all" else subject_type
        totals = self._aggregate_totals(
            period,
            endpoint_id=endpoint_id,
            subject_type=aggregate_type,
        )
        if endpoint_id is not None:
            cost = compute_cost(_resolve_cost_model(self.db, endpoint_id), totals)
        else:
            endpoint_ids = self._endpoint_ids_with_data(period, subject_type=aggregate_type)
            if endpoint_ids:
                costs = [
                    computed
                    for current_endpoint_id in endpoint_ids
                    if (
                        computed := compute_cost(
                            _resolve_cost_model(self.db, current_endpoint_id),
                            self._aggregate_totals(
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
                cost = compute_cost(_resolve_cost_model(self.db, None), totals)
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
        month: str,
        endpoint_id: Optional[int],
        subject_type: str,
        page: int,
        page_size: int,
        sort_by: str,
        sort_dir: str,
        search: Optional[str] = None,
    ) -> CostSubjectsResponse:
        period = parse_cost_month(month)
        subject_type = self._normalize_subject_type(subject_type)
        items = self._all_subject_summaries(period, endpoint_id, subject_type)

        search_value = (search or "").strip().casefold()
        if search_value:
            items = [
                entry
                for entry in items
                if search_value in entry.name.casefold()
                or search_value in (entry.rgw_identifier or "").casefold()
                or search_value in entry.storage_endpoint_name.casefold()
            ]

        def sort_key(entry: CostSubjectSummary):
            if sort_by == "cost":
                return entry.cost.total_cost if entry.cost and entry.cost.total_cost is not None else -1
            if sort_by == "egress":
                return entry.usage.bytes_out
            if sort_by == "ingress":
                return entry.usage.bytes_in
            if sort_by == "storage":
                return entry.storage.avg_bytes or 0
            if sort_by == "requests":
                return entry.usage.ops_total
            if sort_by == "endpoint":
                return entry.storage_endpoint_name.casefold()
            return entry.name.casefold()

        items.sort(key=sort_key, reverse=sort_dir == "desc")
        total = len(items)
        start = max(page - 1, 0) * page_size
        end = start + page_size
        return CostSubjectsResponse(
            items=items[start:end],
            total=total,
            page=page,
            page_size=page_size,
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
        if subject_type == "account":
            subject = self.db.scalar(
                select(S3Account).where(
                    S3Account.id == subject_id,
                    S3Account.storage_endpoint_id == endpoint_id,
                )
            )
        elif subject_type == "s3_user":
            subject = self.db.scalar(
                select(S3User).where(
                    S3User.id == subject_id,
                    S3User.storage_endpoint_id == endpoint_id,
                )
            )
        else:
            raise ValueError("Invalid subject type")
        if not subject:
            raise CostSubjectNotFoundError("Subject not found")

        usage_rows = self._usage_rows_for_subject(period, endpoint_id, subject_type, subject_id)
        storage_rows = self._storage_rows_for_subject(period, endpoint_id, subject_type, subject_id)
        totals = self._subject_totals_from_rows(usage_rows, storage_rows)

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

        daily = [
            CostDailySeriesPoint(day=day, **values)
            for day, values in sorted(daily_map.items())
        ]

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
            cost=compute_cost(_resolve_cost_model(self.db, endpoint_id), totals),
        )

    def subject_history(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
        months: int = 12,
    ) -> list[CostSubjectHistoryPoint]:
        period = parse_cost_month(month)
        subject_type = self._normalize_subject_type(subject_type)
        if subject_type == "all":
            raise ValueError("Invalid subject type")
        if months < 1:
            return []

        model = _resolve_cost_model(self.db, endpoint_id)
        selected_month_index = period.start.year * 12 + period.start.month - 1
        history: list[CostSubjectHistoryPoint] = []
        for month_index in range(selected_month_index - months + 1, selected_month_index + 1):
            year, zero_based_month = divmod(month_index, 12)
            history_period = parse_cost_month(f"{year:04d}-{zero_based_month + 1:02d}")
            usage_rows = self._usage_rows_for_subject(
                history_period,
                endpoint_id,
                subject_type,
                subject_id,
            )
            storage_rows = self._storage_rows_for_subject(
                history_period,
                endpoint_id,
                subject_type,
                subject_id,
            )
            totals = self._subject_totals_from_rows(usage_rows, storage_rows)
            history.append(
                CostSubjectHistoryPoint(
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
        for endpoint in self._ceph_endpoints(endpoint_id):
            current_endpoint_id = int(endpoint.id)
            totals = self._aggregate_totals(
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
                        _resolve_cost_model(self.db, current_endpoint_id),
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
            subject_total_cost=subject_total_cost,
            top_five_ratio=top_five_cost / subject_total_cost if subject_total_cost > 0 else 0,
        )

    def _analytics_history(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> list[CostAnalyticsHistoryPoint]:
        selected_month_index = period.start.year * 12 + period.start.month - 1
        history: list[CostAnalyticsHistoryPoint] = []
        for month_index in range(selected_month_index - 11, selected_month_index + 1):
            year, zero_based_month = divmod(month_index, 12)
            history_period = parse_cost_month(f"{year:04d}-{zero_based_month + 1:02d}")
            history_summary = self._summary_for_period(history_period, endpoint_id, subject_type)
            history.append(
                CostAnalyticsHistoryPoint(
                    month=history_period.month,
                    coverage=history_summary.coverage,
                    cost=history_summary.cost,
                )
            )
        return history

    def _ceph_endpoints(self, endpoint_id: Optional[int]) -> list[StorageEndpoint]:
        statement = select(StorageEndpoint).where(
            StorageEndpoint.provider == StorageProvider.CEPH.value
        )
        if endpoint_id is not None:
            statement = statement.where(StorageEndpoint.id == endpoint_id)
        return self.db.scalars(
            statement.order_by(StorageEndpoint.name.asc(), StorageEndpoint.id.asc())
        ).all()

    def _all_subject_summaries(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: str,
    ) -> list[CostSubjectSummary]:
        subject_types = ("account", "s3_user") if subject_type == "all" else (subject_type,)
        return [
            item
            for endpoint in self._ceph_endpoints(endpoint_id)
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
        usage_by_subject = self._usage_totals_by_subject(
            period,
            endpoint_id,
            subject_type,
        )
        storage_by_subject = self._storage_totals_by_subject(
            period,
            endpoint_id,
            subject_type,
        )
        items: list[CostSubjectSummary] = []
        for subject in self._load_subjects(endpoint_id, subject_type):
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
                        _resolve_cost_model(self.db, endpoint_id),
                        totals,
                    ),
                )
            )
        return items

    def _load_subjects(self, endpoint_id: int, subject_type: str) -> list[CostSubject]:
        if subject_type == "account":
            return self.db.scalars(
                select(S3Account)
                .where(S3Account.storage_endpoint_id == endpoint_id)
                .order_by(S3Account.name.asc())
            ).all()
        return self.db.scalars(
            select(S3User)
            .where(S3User.storage_endpoint_id == endpoint_id)
            .order_by(S3User.name.asc())
        ).all()

    def _endpoint_ids_with_data(
        self,
        period: CostPeriod,
        subject_type: Optional[str] = None,
    ) -> list[int]:
        usage_statement = (
            select(CostUsageDaily.storage_endpoint_id)
            .join(StorageEndpoint, StorageEndpoint.id == CostUsageDaily.storage_endpoint_id)
            .where(
                CostUsageDaily.day >= period.start,
                CostUsageDaily.day < period.end,
                StorageEndpoint.provider == StorageProvider.CEPH.value,
            )
        )
        storage_statement = (
            select(CostStorageDaily.storage_endpoint_id)
            .join(StorageEndpoint, StorageEndpoint.id == CostStorageDaily.storage_endpoint_id)
            .where(
                CostStorageDaily.day >= period.start,
                CostStorageDaily.day < period.end,
                StorageEndpoint.provider == StorageProvider.CEPH.value,
            )
        )
        if subject_type == "account":
            usage_statement = usage_statement.where(CostUsageDaily.s3_account_id.isnot(None))
            storage_statement = storage_statement.where(CostStorageDaily.s3_account_id.isnot(None))
        elif subject_type == "s3_user":
            usage_statement = usage_statement.where(CostUsageDaily.s3_user_id.isnot(None))
            storage_statement = storage_statement.where(CostStorageDaily.s3_user_id.isnot(None))
        usage_ids = self.db.scalars(usage_statement.distinct()).all()
        storage_ids = self.db.scalars(storage_statement.distinct()).all()
        return sorted({int(value) for value in [*usage_ids, *storage_ids]})

    def _aggregate_totals(
        self,
        period: CostPeriod,
        endpoint_id: Optional[int],
        subject_type: Optional[str] = None,
    ) -> CostTotals:
        usage_statement = select(
            func.sum(CostUsageDaily.bytes_in),
            func.sum(CostUsageDaily.bytes_out),
            func.sum(CostUsageDaily.ops_total),
            func.count(func.distinct(CostUsageDaily.day)),
        ).where(
            CostUsageDaily.day >= period.start,
            CostUsageDaily.day < period.end,
        )
        if endpoint_id is not None:
            usage_statement = usage_statement.where(
                CostUsageDaily.storage_endpoint_id == endpoint_id
            )
        else:
            usage_statement = usage_statement.join(
                StorageEndpoint,
                StorageEndpoint.id == CostUsageDaily.storage_endpoint_id,
            ).where(StorageEndpoint.provider == StorageProvider.CEPH.value)
        if subject_type == "account":
            usage_statement = usage_statement.where(CostUsageDaily.s3_account_id.isnot(None))
        elif subject_type == "s3_user":
            usage_statement = usage_statement.where(CostUsageDaily.s3_user_id.isnot(None))
        usage_row = self.db.execute(usage_statement).one()
        bytes_in = int(usage_row[0] or 0)
        bytes_out = int(usage_row[1] or 0)
        ops_total = int(usage_row[2] or 0)
        days_with_usage = int(usage_row[3] or 0)

        storage_statement = select(
            func.sum(CostStorageDaily.total_bytes),
            func.sum(CostStorageDaily.total_objects),
            func.count(func.distinct(CostStorageDaily.day)),
        ).where(
            CostStorageDaily.day >= period.start,
            CostStorageDaily.day < period.end,
        )
        if endpoint_id is not None:
            storage_statement = storage_statement.where(
                CostStorageDaily.storage_endpoint_id == endpoint_id
            )
        else:
            storage_statement = storage_statement.join(
                StorageEndpoint,
                StorageEndpoint.id == CostStorageDaily.storage_endpoint_id,
            ).where(StorageEndpoint.provider == StorageProvider.CEPH.value)
        if subject_type == "account":
            storage_statement = storage_statement.where(CostStorageDaily.s3_account_id.isnot(None))
        elif subject_type == "s3_user":
            storage_statement = storage_statement.where(CostStorageDaily.s3_user_id.isnot(None))
        storage_row = self.db.execute(storage_statement).one()
        total_bytes = storage_row[0] or 0
        total_objects = storage_row[1]
        days_with_storage = int(storage_row[2] or 0)
        avg_storage_bytes = int(total_bytes / days_with_storage) if days_with_storage else None

        return CostTotals(
            bytes_in=bytes_in,
            bytes_out=bytes_out,
            ops_total=ops_total,
            ops_breakdown=None,
            avg_storage_bytes=avg_storage_bytes,
            avg_storage_gb_month=bytes_to_gb(avg_storage_bytes) if avg_storage_bytes is not None else None,
            total_objects=int(total_objects) if total_objects is not None else None,
            days_with_data=max(days_with_storage, days_with_usage),
            storage_days_with_data=days_with_storage,
            usage_days_with_data=days_with_usage,
        )

    def _usage_totals_by_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, tuple[int, int, int]]:
        column = CostUsageDaily.s3_account_id if subject_type == "account" else CostUsageDaily.s3_user_id
        rows = self.db.execute(
            select(
                column,
                func.sum(CostUsageDaily.bytes_in),
                func.sum(CostUsageDaily.bytes_out),
                func.sum(CostUsageDaily.ops_total),
            )
            .where(
                CostUsageDaily.storage_endpoint_id == endpoint_id,
                CostUsageDaily.day >= period.start,
                CostUsageDaily.day < period.end,
                column.isnot(None),
            )
            .group_by(column)
        ).all()
        return {
            int(row[0]): (int(row[1] or 0), int(row[2] or 0), int(row[3] or 0))
            for row in rows
            if row[0] is not None
        }

    def _storage_totals_by_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, tuple[Optional[int], Optional[int], int]]:
        column = CostStorageDaily.s3_account_id if subject_type == "account" else CostStorageDaily.s3_user_id
        rows = self.db.execute(
            select(
                column,
                func.sum(CostStorageDaily.total_bytes),
                func.sum(CostStorageDaily.total_objects),
                func.count(func.distinct(CostStorageDaily.day)),
            )
            .where(
                CostStorageDaily.storage_endpoint_id == endpoint_id,
                CostStorageDaily.day >= period.start,
                CostStorageDaily.day < period.end,
                column.isnot(None),
            )
            .group_by(column)
        ).all()
        results: dict[int, tuple[Optional[int], Optional[int], int]] = {}
        for row in rows:
            subject_id = row[0]
            if subject_id is None:
                continue
            total_bytes = row[1]
            total_objects = row[2]
            days = int(row[3] or 0)
            avg_bytes = int(total_bytes / days) if (total_bytes is not None and days) else None
            results[int(subject_id)] = (
                avg_bytes,
                int(total_objects) if total_objects is not None else None,
                days,
            )
        return results

    def _usage_rows_for_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[CostUsageDaily]:
        column = CostUsageDaily.s3_account_id if subject_type == "account" else CostUsageDaily.s3_user_id
        return self.db.scalars(
            select(CostUsageDaily)
            .where(
                CostUsageDaily.storage_endpoint_id == endpoint_id,
                CostUsageDaily.day >= period.start,
                CostUsageDaily.day < period.end,
                column == subject_id,
            )
            .order_by(CostUsageDaily.day.asc())
        ).all()

    def _storage_rows_for_subject(
        self,
        period: CostPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[CostStorageDaily]:
        column = CostStorageDaily.s3_account_id if subject_type == "account" else CostStorageDaily.s3_user_id
        return self.db.scalars(
            select(CostStorageDaily)
            .where(
                CostStorageDaily.storage_endpoint_id == endpoint_id,
                CostStorageDaily.day >= period.start,
                CostStorageDaily.day < period.end,
                column == subject_id,
            )
            .order_by(CostStorageDaily.day.asc())
        ).all()
