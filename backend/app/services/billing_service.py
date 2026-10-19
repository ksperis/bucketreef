# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import csv
import io
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Iterable, Optional, TypeAlias

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import BillingSubjectNotFoundError
from app.db import (
    BillingRateCard,
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    S3User,
)
from app.models.billing import (
    BillingCost,
    BillingCoverage,
    BillingDailySeriesPoint,
    BillingStorageChargeQuantity,
    BillingStorageTotals,
    BillingSubjectDetail,
    BillingSubjectSummary,
    BillingSubjectsResponse,
    BillingSummary,
    BillingUsageTotals,
)
from app.services.billing_calculation import (
    StorageQuantity,
    allocated_quota_storage_quantity,
    bytes_sum_to_average_gib_month,
    bytes_to_gib,
    component_amount,
    measured_storage_quantity,
    monetary_total,
    requests_to_thousands,
)
from app.services.billing_rate_resolution_service import BillingRateResolutionService

BillingSubject: TypeAlias = S3Account | S3User


@dataclass
class BillingPeriod:
    month: str
    start: date
    end: date
    days_in_month: int


@dataclass
class BillingTotals:
    bytes_in: int
    bytes_out: int
    ops_total: int
    ops_breakdown: Optional[dict[str, int]]
    avg_storage_bytes: Optional[int]
    avg_storage_gb_month: Optional[Decimal]
    storage_total_bytes: int
    total_objects: Optional[int]
    days_with_data: int
    storage_days_with_data: int = 0
    usage_days_with_data: int = 0
    quota_observations: tuple[tuple[Optional[int], str], ...] = ()
    quota_expected_observations: int = 0


@dataclass
class BillingStorageAggregate:
    total_bytes: int
    avg_bytes: Optional[int]
    avg_gb_month: Optional[Decimal]
    total_objects: Optional[int]
    days_with_data: int
    quota_observations: tuple[tuple[Optional[int], str], ...]


@dataclass
class BillingUsageAggregate:
    bytes_in: int
    bytes_out: int
    ops_total: int
    days_with_data: int


def _parse_month(value: str) -> BillingPeriod:
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
    return BillingPeriod(month=text, start=period_start, end=period_end, days_in_month=days_in_month)


def _coverage(
    days_collected: int,
    days_in_month: int,
    *,
    storage_days_collected: Optional[int] = None,
    usage_days_collected: Optional[int] = None,
) -> BillingCoverage:
    ratio = days_collected / days_in_month if days_in_month else 0
    return BillingCoverage(
        days_collected=days_collected,
        days_in_month=days_in_month,
        coverage_ratio=ratio,
        storage_days_collected=storage_days_collected,
        usage_days_collected=usage_days_collected,
    )


def _bytes_to_gb(value: Optional[int]) -> Optional[Decimal]:
    return bytes_to_gib(value)


def _parse_ops_breakdown(raw: str) -> dict[str, int]:
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Billing operation breakdown must be a JSON object")
    if any(
        not isinstance(key, str)
        or not isinstance(value, int)
        or isinstance(value, bool)
        for key, value in payload.items()
    ):
        raise ValueError("Billing operation breakdown must map strings to integers")
    return payload


def _merge_ops_breakdown(rows: Iterable[BillingUsageDaily]) -> dict[str, int]:
    merged: dict[str, int] = defaultdict(int)
    for row in rows:
        if not row.ops_breakdown:
            continue
        for key, value in _parse_ops_breakdown(row.ops_breakdown).items():
            merged[key] += value
    return dict(merged)


def _storage_quantity_for_cost(
    rate_card: BillingRateCard,
    totals: BillingTotals,
    period: BillingPeriod,
) -> StorageQuantity:
    if rate_card.storage_charge_basis == "allocated_quota":
        return allocated_quota_storage_quantity(
            observations=totals.quota_observations,
            days_in_month=period.days_in_month,
            expected_observations=totals.quota_expected_observations,
        )
    return measured_storage_quantity(
        total_bytes=totals.storage_total_bytes,
        observed_days=totals.storage_days_with_data,
        days_in_month=period.days_in_month,
    )


def _storage_quantity_model(quantity: StorageQuantity) -> BillingStorageChargeQuantity:
    return BillingStorageChargeQuantity(
        basis=quantity.basis,
        quantity_gib_month=quantity.quantity_gib_month,
        observations_collected=quantity.observations_collected,
        observations_expected=quantity.observations_expected,
        calendar_days=quantity.calendar_days,
        coverage_ratio=quantity.coverage_ratio,
        status=quantity.status,
        issues=list(quantity.issues),
    )


def _compute_cost(
    rate_card: Optional[BillingRateCard],
    totals: BillingTotals,
    period: BillingPeriod,
) -> Optional[BillingCost]:
    if not rate_card:
        return None
    storage_quantity = _storage_quantity_for_cost(rate_card, totals, period)
    egress_gb = bytes_to_gib(totals.bytes_out)
    ingress_gb = bytes_to_gib(totals.bytes_in)
    requests_k = requests_to_thousands(totals.ops_total)

    storage_cost = component_amount(rate_card.storage_gb_month_price, storage_quantity.quantity_gib_month)
    egress_cost = component_amount(rate_card.egress_gb_price, egress_gb)
    ingress_cost = component_amount(rate_card.ingress_gb_price, ingress_gb)
    requests_cost = component_amount(rate_card.requests_per_1000_price, requests_k)

    storage_required_without_quantity = (
        rate_card.storage_gb_month_price is not None
        and storage_quantity.quantity_gib_month is None
    )
    total_cost = None if storage_required_without_quantity else monetary_total(
        (storage_cost, egress_cost, ingress_cost, requests_cost)
    )
    complete = (
        rate_card.storage_gb_month_price is None
        or storage_quantity.status == "complete"
    )

    return BillingCost(
        currency=rate_card.currency,
        storage_cost=storage_cost,
        egress_cost=egress_cost,
        ingress_cost=ingress_cost,
        requests_cost=requests_cost,
        total_cost=total_cost,
        rate_card_name=rate_card.rate_plan.name,
        storage_quantity=_storage_quantity_model(storage_quantity),
        complete=complete,
    )


def _usage_totals(totals: BillingTotals) -> BillingUsageTotals:
    return BillingUsageTotals(
        bytes_in=totals.bytes_in,
        bytes_out=totals.bytes_out,
        ops_total=totals.ops_total,
        ops_breakdown=totals.ops_breakdown,
    )


def _storage_totals(totals: BillingTotals) -> BillingStorageTotals:
    return BillingStorageTotals(
        avg_bytes=totals.avg_storage_bytes,
        avg_gb_month=totals.avg_storage_gb_month,
        total_objects=totals.total_objects,
    )


def _coverage_for_period(period: BillingPeriod, totals: BillingTotals) -> BillingCoverage:
    return _coverage(
        totals.days_with_data,
        period.days_in_month,
        storage_days_collected=totals.storage_days_with_data,
        usage_days_collected=totals.usage_days_with_data,
    )


def _resolve_rate_card(
    db: Session,
    endpoint_id: Optional[int],
    period: BillingPeriod,
    subject_type: Optional[str] = None,
    subject_id: Optional[int] = None,
) -> Optional[BillingRateCard]:
    return BillingRateResolutionService(db).resolve(
        endpoint_id=endpoint_id,
        period_start=period.start,
        subject_type=subject_type,
        subject_id=subject_id,
    ).rate_card


class BillingService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.rate_resolver = BillingRateResolutionService(db)

    def summary(self, month: str, endpoint_id: Optional[int]) -> BillingSummary:
        period = _parse_month(month)
        totals = self._aggregate_totals(period, endpoint_id=endpoint_id)
        resolved_rate = self.rate_resolver.resolve(
            endpoint_id=endpoint_id,
            period_start=period.start,
        )
        cost = _compute_cost(resolved_rate.rate_card, totals, period)
        return BillingSummary(
            month=period.month,
            storage_endpoint_id=endpoint_id,
            usage=_usage_totals(totals),
            storage=_storage_totals(totals),
            coverage=_coverage_for_period(period, totals),
            cost=cost,
            rate_resolution=resolved_rate.explanation,
        )

    def list_subjects(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
        page: int,
        page_size: int,
        sort_by: str,
        sort_dir: str,
    ) -> BillingSubjectsResponse:
        period = _parse_month(month)
        subject_type = subject_type.lower().strip()
        if subject_type not in {"account", "s3_user"}:
            raise ValueError("Invalid subject type")
        items = self._subject_summaries(period, endpoint_id, subject_type)

        def sort_key(entry: BillingSubjectSummary):
            if sort_by == "cost":
                return entry.cost.total_cost if entry.cost and entry.cost.total_cost is not None else -1
            if sort_by == "egress":
                return entry.usage.bytes_out
            if sort_by == "storage":
                return entry.storage.avg_bytes or 0
            if sort_by == "requests":
                return entry.usage.ops_total
            return entry.name.lower()

        items.sort(key=sort_key, reverse=sort_dir == "desc")
        total = len(items)
        start = max(page - 1, 0) * page_size
        end = start + page_size
        sliced = items[start:end]
        has_next = end < total
        return BillingSubjectsResponse(
            items=sliced,
            total=total,
            page=page,
            page_size=page_size,
            has_next=has_next,
        )

    def analysis_subjects(
        self,
        month: str,
        endpoint_id: int,
        subject_type: str,
    ) -> list[BillingSubjectSummary]:
        """Return canonical priced subject rows for Billing analysis composition."""
        period = _parse_month(month)
        normalized_type = subject_type.lower().strip()
        if normalized_type not in {"account", "s3_user"}:
            raise ValueError("Invalid subject type")
        return self._subject_summaries(period, endpoint_id, normalized_type)

    def subject_detail(self, month: str, endpoint_id: int, subject_type: str, subject_id: int) -> BillingSubjectDetail:
        period = _parse_month(month)
        subject_type = subject_type.lower().strip()
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
            raise BillingSubjectNotFoundError("Subject not found")

        usage_rows = self._usage_rows_for_subject(period, endpoint_id, subject_type, subject_id)
        storage_rows = self._storage_rows_for_subject(period, endpoint_id, subject_type, subject_id)
        total_storage_bytes = sum(row.total_bytes for row in storage_rows)
        days_with_storage = len(storage_rows)
        avg_storage_bytes = total_storage_bytes // days_with_storage if days_with_storage else None
        usage_days = len({row.day for row in usage_rows})
        totals = BillingTotals(
            bytes_in=sum(row.bytes_in for row in usage_rows),
            bytes_out=sum(row.bytes_out for row in usage_rows),
            ops_total=sum(row.ops_total for row in usage_rows),
            ops_breakdown=_merge_ops_breakdown(usage_rows) if usage_rows else None,
            avg_storage_bytes=avg_storage_bytes,
            avg_storage_gb_month=bytes_sum_to_average_gib_month(
                total_storage_bytes,
                days_with_storage,
            ),
            storage_total_bytes=total_storage_bytes,
            total_objects=(sum(row.total_objects for row in storage_rows) if storage_rows else None),
            days_with_data=max(days_with_storage, usage_days),
            storage_days_with_data=days_with_storage,
            usage_days_with_data=usage_days,
            quota_observations=tuple(
                (row.quota_size_bytes, row.quota_state)
                for row in storage_rows
            ),
            quota_expected_observations=period.days_in_month,
        )

        daily_map: dict[str, BillingDailySeriesPoint] = {}
        for row in storage_rows:
            key = row.day.isoformat()
            daily_map[key] = BillingDailySeriesPoint(
                day=key,
                storage_bytes=row.total_bytes,
                quota_size_bytes=row.quota_size_bytes,
                quota_state=row.quota_state,
            )
        for row in usage_rows:
            key = row.day.isoformat()
            entry = daily_map.get(key) or BillingDailySeriesPoint(day=key)
            entry.bytes_in = row.bytes_in
            entry.bytes_out = row.bytes_out
            entry.ops_total = row.ops_total
            daily_map[key] = entry

        daily = sorted(daily_map.values(), key=lambda entry: entry.day)
        resolved_rate = self.rate_resolver.resolve(
            endpoint_id=endpoint_id,
            period_start=period.start,
            subject_type=subject_type,
            subject_id=subject_id,
        )
        cost = _compute_cost(resolved_rate.rate_card, totals, period)

        return BillingSubjectDetail(
            month=period.month,
            subject_type=subject_type,
            subject_id=subject_id,
            name=subject.name,
            rgw_identifier=subject.rgw_user_uid,
            daily=daily,
            usage=_usage_totals(totals),
            storage=_storage_totals(totals),
            coverage=_coverage_for_period(period, totals),
            cost=cost,
            rate_resolution=resolved_rate.explanation,
        )

    def export_csv(self, month: str, endpoint_id: int) -> tuple[str, str]:
        period = _parse_month(month)
        rows = [
            item
            for subject_type in ("account", "s3_user")
            for item in self._subject_summaries(period, endpoint_id, subject_type)
        ]

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "subject_type",
                "subject_id",
                "name",
                "rgw_identifier",
                "avg_storage_gb_month",
                "egress_gb",
                "ingress_gb",
                "requests_k",
                "storage_charge_basis",
                "priced_storage_gib_month",
                "storage_quantity_status",
                "storage_quantity_coverage",
                "rate_resolution_status",
                "rate_source_layer",
                "rate_plan_id",
                "rate_plan_name",
                "rate_card_id",
                "rate_card_effective_from",
                "billing_entity_id",
                "total_cost",
                "currency",
            ]
        )
        for item in rows:
            writer.writerow(
                [
                    item.subject_type,
                    item.subject_id,
                    item.name,
                    item.rgw_identifier or "",
                    format(item.storage.avg_gb_month, "f") if item.storage.avg_gb_month is not None else "",
                    format(_bytes_to_gb(item.usage.bytes_out), "f") if item.usage.bytes_out is not None else "",
                    format(_bytes_to_gb(item.usage.bytes_in), "f") if item.usage.bytes_in is not None else "",
                    format(requests_to_thousands(item.usage.ops_total), "f") if item.usage.ops_total is not None else "",
                    item.cost.storage_quantity.basis if item.cost and item.cost.storage_quantity else "",
                    (
                        format(item.cost.storage_quantity.quantity_gib_month, "f")
                        if item.cost
                        and item.cost.storage_quantity
                        and item.cost.storage_quantity.quantity_gib_month is not None
                        else ""
                    ),
                    item.cost.storage_quantity.status if item.cost and item.cost.storage_quantity else "",
                    (
                        format(item.cost.storage_quantity.coverage_ratio, "f")
                        if item.cost and item.cost.storage_quantity
                        else ""
                    ),
                    item.rate_resolution.status,
                    item.rate_resolution.layer or "",
                    item.rate_resolution.rate_plan_id or "",
                    item.rate_resolution.rate_plan_name or "",
                    item.rate_resolution.rate_card_id or "",
                    (
                        item.rate_resolution.rate_card_effective_from.isoformat()
                        if item.rate_resolution.rate_card_effective_from
                        else ""
                    ),
                    item.rate_resolution.billing_entity_id or "",
                    f"{item.cost.total_cost:.6f}" if item.cost and item.cost.total_cost is not None else "",
                    item.cost.currency if item.cost and item.cost.currency else "",
                ]
            )
        filename = f"billing-{period.month}-endpoint-{endpoint_id}.csv"
        return filename, output.getvalue()

    def _subject_summaries(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> list[BillingSubjectSummary]:
        usage_totals = self._usage_totals_by_subject(period, endpoint_id, subject_type)
        storage_totals = self._storage_totals_by_subject(period, endpoint_id, subject_type)
        items: list[BillingSubjectSummary] = []
        for subject in self._load_subjects(endpoint_id, subject_type):
            subject_id = subject.id
            usage = usage_totals.get(
                subject_id,
                BillingUsageAggregate(
                    bytes_in=0,
                    bytes_out=0,
                    ops_total=0,
                    days_with_data=0,
                ),
            )
            storage = storage_totals.get(
                subject_id,
                BillingStorageAggregate(
                    total_bytes=0,
                    avg_bytes=None,
                    avg_gb_month=None,
                    total_objects=None,
                    days_with_data=0,
                    quota_observations=(),
                ),
            )
            totals = BillingTotals(
                bytes_in=usage.bytes_in,
                bytes_out=usage.bytes_out,
                ops_total=usage.ops_total,
                ops_breakdown=None,
                avg_storage_bytes=storage.avg_bytes,
                avg_storage_gb_month=storage.avg_gb_month,
                storage_total_bytes=storage.total_bytes,
                total_objects=storage.total_objects,
                days_with_data=max(storage.days_with_data, usage.days_with_data),
                storage_days_with_data=storage.days_with_data,
                usage_days_with_data=usage.days_with_data,
                quota_observations=storage.quota_observations,
                quota_expected_observations=period.days_in_month,
            )
            resolved_rate = self.rate_resolver.resolve(
                endpoint_id=endpoint_id,
                period_start=period.start,
                subject_type=subject_type,
                subject_id=subject_id,
            )
            items.append(
                BillingSubjectSummary(
                    subject_type=subject_type,
                    subject_id=subject_id,
                    name=subject.name,
                    rgw_identifier=subject.rgw_user_uid,
                    storage=_storage_totals(totals),
                    usage=_usage_totals(totals),
                    coverage=_coverage_for_period(period, totals),
                    cost=_compute_cost(resolved_rate.rate_card, totals, period),
                    rate_resolution=resolved_rate.explanation,
                )
            )
        return items

    def _load_subjects(self, endpoint_id: int, subject_type: str) -> list[BillingSubject]:
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

    def _aggregate_totals(self, period: BillingPeriod, endpoint_id: Optional[int]) -> BillingTotals:
        usage_statement = select(
            func.sum(BillingUsageDaily.bytes_in),
            func.sum(BillingUsageDaily.bytes_out),
            func.sum(BillingUsageDaily.ops_total),
            func.count(func.distinct(BillingUsageDaily.day)),
        ).where(
            BillingUsageDaily.day >= period.start,
            BillingUsageDaily.day < period.end,
        )
        if endpoint_id is not None:
            usage_statement = usage_statement.where(
                BillingUsageDaily.storage_endpoint_id == endpoint_id
            )
        usage_row = self.db.execute(usage_statement).one()
        bytes_in = int(usage_row[0] or 0)
        bytes_out = int(usage_row[1] or 0)
        ops_total = int(usage_row[2] or 0)
        days_with_usage = int(usage_row[3] or 0)

        storage_statement = select(BillingStorageDaily).where(
            BillingStorageDaily.day >= period.start,
            BillingStorageDaily.day < period.end,
        )
        if endpoint_id is not None:
            storage_statement = storage_statement.where(
                BillingStorageDaily.storage_endpoint_id == endpoint_id
            )
        storage_rows = self.db.scalars(storage_statement).all()
        total_bytes = sum(row.total_bytes for row in storage_rows)
        total_objects = sum(row.total_objects for row in storage_rows) if storage_rows else None
        days_with_storage = len({row.day for row in storage_rows})
        avg_storage_bytes = total_bytes // days_with_storage if days_with_storage else None
        quota_expected_observations = 0
        if endpoint_id is not None:
            quota_expected_observations = period.days_in_month * self._billing_subject_count(endpoint_id)

        return BillingTotals(
            bytes_in=bytes_in,
            bytes_out=bytes_out,
            ops_total=ops_total,
            ops_breakdown=None,
            avg_storage_bytes=avg_storage_bytes,
            avg_storage_gb_month=bytes_sum_to_average_gib_month(total_bytes, days_with_storage),
            storage_total_bytes=total_bytes,
            total_objects=total_objects,
            days_with_data=max(days_with_storage, days_with_usage),
            storage_days_with_data=days_with_storage,
            usage_days_with_data=days_with_usage,
            quota_observations=tuple(
                (row.quota_size_bytes, row.quota_state)
                for row in storage_rows
            ),
            quota_expected_observations=quota_expected_observations,
        )

    def _usage_totals_by_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, BillingUsageAggregate]:
        column = BillingUsageDaily.s3_account_id if subject_type == "account" else BillingUsageDaily.s3_user_id
        rows = self.db.execute(
            select(
                column,
                func.sum(BillingUsageDaily.bytes_in),
                func.sum(BillingUsageDaily.bytes_out),
                func.sum(BillingUsageDaily.ops_total),
                func.count(func.distinct(BillingUsageDaily.day)),
            )
            .where(
                BillingUsageDaily.storage_endpoint_id == endpoint_id,
                BillingUsageDaily.day >= period.start,
                BillingUsageDaily.day < period.end,
                column.isnot(None),
            )
            .group_by(column)
        ).all()
        return {
            row[0]: BillingUsageAggregate(
                bytes_in=int(row[1] or 0),
                bytes_out=int(row[2] or 0),
                ops_total=int(row[3] or 0),
                days_with_data=int(row[4] or 0),
            )
            for row in rows
            if row[0] is not None
        }

    def _storage_totals_by_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
    ) -> dict[int, BillingStorageAggregate]:
        column = BillingStorageDaily.s3_account_id if subject_type == "account" else BillingStorageDaily.s3_user_id
        rows = self.db.scalars(
            select(BillingStorageDaily)
            .where(
                BillingStorageDaily.storage_endpoint_id == endpoint_id,
                BillingStorageDaily.day >= period.start,
                BillingStorageDaily.day < period.end,
                column.isnot(None),
            )
            .order_by(column.asc(), BillingStorageDaily.day.asc())
        ).all()
        grouped: dict[int, list[BillingStorageDaily]] = defaultdict(list)
        for row in rows:
            subject_id = row.s3_account_id if subject_type == "account" else row.s3_user_id
            if subject_id is None:
                continue
            grouped[int(subject_id)].append(row)

        results: dict[int, BillingStorageAggregate] = {}
        for subject_id, subject_rows in grouped.items():
            total_bytes = sum(row.total_bytes for row in subject_rows)
            days = len({row.day for row in subject_rows})
            results[subject_id] = BillingStorageAggregate(
                total_bytes=total_bytes,
                avg_bytes=total_bytes // days if days else None,
                avg_gb_month=bytes_sum_to_average_gib_month(total_bytes, days),
                total_objects=sum(row.total_objects for row in subject_rows),
                days_with_data=days,
                quota_observations=tuple(
                    (row.quota_size_bytes, row.quota_state)
                    for row in subject_rows
                ),
            )
        return results

    def _billing_subject_count(self, endpoint_id: int) -> int:
        accounts = self.db.scalar(
            select(func.count(S3Account.id)).where(S3Account.storage_endpoint_id == endpoint_id)
        ) or 0
        users = self.db.scalar(
            select(func.count(S3User.id)).where(S3User.storage_endpoint_id == endpoint_id)
        ) or 0
        return int(accounts) + int(users)

    def _usage_rows_for_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[BillingUsageDaily]:
        column = BillingUsageDaily.s3_account_id if subject_type == "account" else BillingUsageDaily.s3_user_id
        return self.db.scalars(
            select(BillingUsageDaily)
            .where(
                BillingUsageDaily.storage_endpoint_id == endpoint_id,
                BillingUsageDaily.day >= period.start,
                BillingUsageDaily.day < period.end,
                column == subject_id,
            )
            .order_by(BillingUsageDaily.day.asc())
        ).all()

    def _storage_rows_for_subject(
        self,
        period: BillingPeriod,
        endpoint_id: int,
        subject_type: str,
        subject_id: int,
    ) -> list[BillingStorageDaily]:
        column = BillingStorageDaily.s3_account_id if subject_type == "account" else BillingStorageDaily.s3_user_id
        return self.db.scalars(
            select(BillingStorageDaily)
            .where(
                BillingStorageDaily.storage_endpoint_id == endpoint_id,
                BillingStorageDaily.day >= period.start,
                BillingStorageDaily.day < period.end,
                column == subject_id,
            )
            .order_by(BillingStorageDaily.day.asc())
        ).all()
