# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import base64
import binascii
import csv
import io
import json
from datetime import date
from typing import Literal, Optional

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.domain_errors import BillingDisabledError
from app.db import BillingEntity, BillingEntityGroup, BillingEntityGroupMembership, BillingStatement
from app.models.billing import BillingAnalysisCoverage, BillingStatementLineSnapshot
from app.models.billing_integration import (
    BillingIntegrationAmountsV1,
    BillingIntegrationCoverageV1,
    BillingIntegrationCurrencyTotalV1,
    BillingIntegrationEntityContributionV1,
    BillingIntegrationEntityV1,
    BillingIntegrationGroupMembershipV1,
    BillingIntegrationGroupV1,
    BillingIntegrationLineCoverageV1,
    BillingIntegrationMembershipReasonV1,
    BillingIntegrationPeriodMonthV1,
    BillingIntegrationPeriodV1,
    BillingIntegrationPricedStorageQuantityV1,
    BillingIntegrationRateResolutionV1,
    BillingIntegrationStatementDetailV1,
    BillingIntegrationStatementLineV1,
    BillingIntegrationStatementPageV1,
    BillingIntegrationStatementSummaryV1,
    BillingIntegrationStorageV1,
    BillingIntegrationUnitPricesV1,
    BillingIntegrationUsageV1,
)
from app.services.app_settings_service import load_app_settings_for_db
from app.services.billing_period_service import BillingFinalizedPeriodService
from app.services.billing_service import _parse_month


class BillingIntegrationNotFoundError(ValueError):
    pass


class BillingIntegrationService:
    """Stable read-only Billing Integration API v1 projection.

    This service intentionally maps canonical Billing domain objects to a
    versioned external contract instead of exposing Admin response models.
    """

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_entities(self) -> list[BillingIntegrationEntityV1]:
        self._ensure_enabled()
        rows = self.db.scalars(
            select(BillingEntity).order_by(BillingEntity.name.asc(), BillingEntity.id.asc())
        ).all()
        return [self._entity_item(row) for row in rows]

    def list_groups(self, *, month: str | None = None) -> list[BillingIntegrationGroupV1]:
        self._ensure_enabled()
        month_start: date | None = None
        normalized_month: str | None = None
        if month is not None:
            period = _parse_month(month)
            month_start = period.start
            normalized_month = period.month
        rows = self.db.scalars(
            select(BillingEntityGroup)
            .options(
                selectinload(BillingEntityGroup.memberships).joinedload(BillingEntityGroupMembership.entity)
            )
            .order_by(BillingEntityGroup.name.asc(), BillingEntityGroup.id.asc())
        ).unique().all()
        return [
            self._group_item(row, month_start=month_start, normalized_month=normalized_month)
            for row in rows
        ]

    def finalized_period(
        self,
        *,
        scope_type: Literal["entity", "group"],
        scope_id: int,
        period_type: Literal["month", "year", "range"],
        month: str | None = None,
        year: int | None = None,
        start_month: str | None = None,
        end_month: str | None = None,
    ) -> BillingIntegrationPeriodV1:
        self._ensure_enabled()
        normalized_start, normalized_end = self.resolve_period(
            period_type=period_type,
            month=month,
            year=year,
            start_month=start_month,
            end_month=end_month,
        )
        result = BillingFinalizedPeriodService(self.db).aggregate(
            scope_type=scope_type,
            scope_id=scope_id,
            start_month=normalized_start,
            end_month=normalized_end,
        )
        return BillingIntegrationPeriodV1(
            period_type=period_type,
            scope_type=result.scope_type,
            scope_id=result.scope_id,
            scope_name=result.scope_name,
            scope_code=result.scope_code,
            scope_external_id=result.scope_external_id,
            start_month=result.start_month,
            end_month=result.end_month,
            expected_months=result.expected_months,
            finalized_months=result.finalized_months,
            missing_months=result.missing_months,
            unfinalized_months=result.unfinalized_months,
            currency_totals=[self._currency_total(item) for item in result.currency_totals],
            months=[
                BillingIntegrationPeriodMonthV1(
                    month=item.month,
                    member_entity_ids=item.member_entity_ids,
                    finalized_entity_ids=item.finalized_entity_ids,
                    missing_entity_ids=item.missing_entity_ids,
                    unfinalized_entity_ids=item.unfinalized_entity_ids,
                    statement_ids=item.statement_ids,
                    currency_totals=[self._currency_total(total) for total in item.currency_totals],
                    entity_contributions=[
                        BillingIntegrationEntityContributionV1(
                            billing_entity_id=contribution.billing_entity_id,
                            billing_entity_name=contribution.billing_entity_name,
                            billing_entity_code=contribution.billing_entity_code,
                            billing_entity_external_id=contribution.billing_entity_external_id,
                            statement_ids=contribution.statement_ids,
                            currency_totals=[
                                self._currency_total(total)
                                for total in contribution.currency_totals
                            ],
                        )
                        for contribution in item.entity_contributions
                    ],
                    complete=item.complete,
                )
                for item in result.months
            ],
            complete=result.complete,
        )

    def list_finalized_statements(
        self,
        *,
        start_month: str | None = None,
        end_month: str | None = None,
        billing_entity_id: int | None = None,
        billing_entity_external_id: str | None = None,
        currency: str | None = None,
        limit: int = 50,
        cursor: str | None = None,
    ) -> BillingIntegrationStatementPageV1:
        self._ensure_enabled()
        normalized_limit = min(max(int(limit), 1), 200)
        statement = select(BillingStatement).where(BillingStatement.status == "finalized")

        if start_month is not None:
            statement = statement.where(BillingStatement.period_start >= _parse_month(start_month).start)
        if end_month is not None:
            statement = statement.where(BillingStatement.period_start < _parse_month(end_month).end)
        if start_month is not None and end_month is not None:
            if _parse_month(end_month).start < _parse_month(start_month).start:
                raise ValueError("end_month must not be before start_month")
        if billing_entity_id is not None:
            statement = statement.where(BillingStatement.billing_entity_id == billing_entity_id)
        if billing_entity_external_id is not None:
            normalized_external_id = billing_entity_external_id.strip()
            if not normalized_external_id:
                raise ValueError("billing_entity_external_id must not be empty")
            statement = statement.where(
                BillingStatement.billing_entity_external_id == normalized_external_id
            )
        if currency is not None:
            normalized_currency = currency.strip().upper()
            if len(normalized_currency) != 3 or not normalized_currency.isalpha():
                raise ValueError("currency must be a 3-letter ISO code")
            statement = statement.where(BillingStatement.currency == normalized_currency)

        if cursor:
            cursor_period, cursor_id = self._decode_cursor(cursor)
            statement = statement.where(
                or_(
                    BillingStatement.period_start < cursor_period,
                    (
                        (BillingStatement.period_start == cursor_period)
                        & (BillingStatement.id < cursor_id)
                    ),
                )
            )

        rows = list(
            self.db.scalars(
                statement.order_by(
                    BillingStatement.period_start.desc(),
                    BillingStatement.id.desc(),
                ).limit(normalized_limit + 1)
            ).all()
        )
        has_more = len(rows) > normalized_limit
        page_rows = rows[:normalized_limit]
        next_cursor = (
            self._encode_cursor(page_rows[-1].period_start, page_rows[-1].id)
            if has_more and page_rows
            else None
        )
        return BillingIntegrationStatementPageV1(
            items=[self._statement_summary(row) for row in page_rows],
            limit=normalized_limit,
            has_more=has_more,
            next_cursor=next_cursor,
        )

    def get_finalized_statement(self, public_id: str) -> BillingIntegrationStatementDetailV1:
        self._ensure_enabled()
        row = self.db.scalar(
            select(BillingStatement)
            .where(
                BillingStatement.public_id == public_id,
                BillingStatement.status == "finalized",
            )
            .options(selectinload(BillingStatement.lines))
        )
        if row is None:
            raise BillingIntegrationNotFoundError("Finalized Billing Statement not found")
        summary = self._statement_summary(row)
        return BillingIntegrationStatementDetailV1(
            **summary.model_dump(),
            lines=[self._statement_line(line.line_index, line.snapshot_json) for line in row.lines],
        )

    def export_json(self, public_id: str) -> tuple[str, str]:
        item = self.get_finalized_statement(public_id)
        return f"billing-statement-{item.statement_public_id}.json", item.model_dump_json(indent=2)

    def export_csv(self, public_id: str) -> tuple[str, str]:
        item = self.get_finalized_statement(public_id)
        output = io.StringIO(newline="")
        writer = csv.writer(output)
        writer.writerow(
            [
                "statement_id",
                "statement_public_id",
                "period_start",
                "period_end",
                "billing_entity_id",
                "billing_entity_name",
                "billing_entity_code",
                "billing_entity_external_id",
                "currency",
                "statement_total",
                "line_index",
                "subject_type",
                "subject_id",
                "subject_name",
                "rgw_identifier",
                "endpoint_id",
                "endpoint_name",
                "membership_reasons",
                "storage_charge_basis",
                "priced_storage_gib_month",
                "measured_storage_gib_month",
                "bytes_in",
                "bytes_out",
                "requests",
                "rate_resolution_source",
                "rate_plan_id",
                "rate_plan_name",
                "rate_card_id",
                "storage_unit_price",
                "egress_unit_price",
                "ingress_unit_price",
                "requests_per_1000_unit_price",
                "storage_cost",
                "egress_cost",
                "ingress_cost",
                "requests_cost",
                "line_total",
                "complete",
                "issues",
            ]
        )
        for line in item.lines:
            writer.writerow(
                [
                    item.statement_id,
                    item.statement_public_id,
                    item.period_start.isoformat(),
                    item.period_end.isoformat(),
                    item.billing_entity_id,
                    item.billing_entity_name,
                    item.billing_entity_code or "",
                    item.billing_entity_external_id or "",
                    item.currency,
                    str(item.total),
                    line.line_index,
                    line.subject_type,
                    line.subject_id,
                    line.subject_name,
                    line.rgw_identifier,
                    line.storage_endpoint_id,
                    line.storage_endpoint_name,
                    json.dumps(
                        [reason.model_dump(mode="json") for reason in line.membership_reasons],
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ),
                    line.storage_charge_basis or "",
                    str(line.priced_storage_quantity.quantity_gib_month)
                    if line.priced_storage_quantity
                    and line.priced_storage_quantity.quantity_gib_month is not None
                    else "",
                    str(line.storage.measured_gib_month)
                    if line.storage.measured_gib_month is not None
                    else "",
                    line.usage.bytes_in,
                    line.usage.bytes_out,
                    line.usage.ops_total,
                    line.rate_resolution.layer or "",
                    line.rate_resolution.rate_plan_id or "",
                    line.rate_resolution.rate_plan_name or "",
                    line.rate_resolution.rate_card_id or "",
                    self._decimal_text(line.unit_prices.storage_gb_month_price),
                    self._decimal_text(line.unit_prices.egress_gb_price),
                    self._decimal_text(line.unit_prices.ingress_gb_price),
                    self._decimal_text(line.unit_prices.requests_per_1000_price),
                    self._decimal_text(line.amounts.storage_cost),
                    self._decimal_text(line.amounts.egress_cost),
                    self._decimal_text(line.amounts.ingress_cost),
                    self._decimal_text(line.amounts.requests_cost),
                    self._decimal_text(line.amounts.total_cost),
                    line.complete,
                    json.dumps(line.issues, ensure_ascii=False, separators=(",", ":")),
                ]
            )
        return f"billing-statement-{item.statement_public_id}.csv", output.getvalue()

    @staticmethod
    def resolve_period(
        *,
        period_type: Literal["month", "year", "range"],
        month: str | None,
        year: int | None,
        start_month: str | None,
        end_month: str | None,
    ) -> tuple[str, str]:
        supplied = {
            "month": month is not None,
            "year": year is not None,
            "start_month": start_month is not None,
            "end_month": end_month is not None,
        }
        if period_type == "month":
            if not supplied["month"] or any(supplied[key] for key in ("year", "start_month", "end_month")):
                raise ValueError("period=month requires only the month parameter")
            normalized = _parse_month(month or "").month
            return normalized, normalized
        if period_type == "year":
            if not supplied["year"] or any(supplied[key] for key in ("month", "start_month", "end_month")):
                raise ValueError("period=year requires only the year parameter")
            if year is None or year < 1 or year > 9999:
                raise ValueError("year must be between 1 and 9999")
            return f"{year:04d}-01", f"{year:04d}-12"
        if period_type == "range":
            if not supplied["start_month"] or not supplied["end_month"] or any(
                supplied[key] for key in ("month", "year")
            ):
                raise ValueError("period=range requires only start_month and end_month")
            start = _parse_month(start_month or "")
            end = _parse_month(end_month or "")
            if end.start < start.start:
                raise ValueError("end_month must not be before start_month")
            return start.month, end.month
        raise ValueError("Unsupported period")

    def _ensure_enabled(self) -> None:
        if not load_app_settings_for_db(self.db).general.billing_enabled:
            raise BillingDisabledError("Billing is disabled")

    @staticmethod
    def _entity_item(row: BillingEntity) -> BillingIntegrationEntityV1:
        return BillingIntegrationEntityV1(
            id=row.id,
            name=row.name,
            code=row.code,
            external_id=row.external_id,
            subject_type=row.subject_type,
            active=bool(row.active),
        )

    @staticmethod
    def _group_item(
        row: BillingEntityGroup,
        *,
        month_start: date | None,
        normalized_month: str | None,
    ) -> BillingIntegrationGroupV1:
        memberships = [
            membership
            for membership in row.memberships
            if month_start is None
            or (
                membership.effective_from <= month_start
                and (membership.effective_to is None or membership.effective_to >= month_start)
            )
        ]
        return BillingIntegrationGroupV1(
            id=row.id,
            name=row.name,
            code=row.code,
            external_id=row.external_id,
            description=row.description,
            active=bool(row.active),
            membership_month=normalized_month,
            memberships=[
                BillingIntegrationGroupMembershipV1(
                    billing_entity_id=membership.billing_entity_id,
                    billing_entity_name=membership.entity.name,
                    billing_entity_code=membership.entity.code,
                    billing_entity_external_id=membership.entity.external_id,
                    billing_entity_active=bool(membership.entity.active),
                    effective_from=membership.effective_from,
                    effective_to=membership.effective_to,
                )
                for membership in memberships
            ],
        )

    @staticmethod
    def _statement_summary(row: BillingStatement) -> BillingIntegrationStatementSummaryV1:
        if row.finalized_at is None:
            raise ValueError("Finalized Billing Statement has no finalized timestamp")
        coverage = BillingAnalysisCoverage.model_validate_json(row.coverage_json)
        return BillingIntegrationStatementSummaryV1(
            statement_id=row.id,
            statement_public_id=row.public_id,
            billing_entity_id=row.billing_entity_id,
            billing_entity_name=row.billing_entity_name,
            billing_entity_code=row.billing_entity_code,
            billing_entity_external_id=row.billing_entity_external_id,
            subject_type=row.subject_type,
            period_start=row.period_start,
            period_end=row.period_end,
            currency=row.currency,
            member_count=row.member_count,
            coverage=BillingIntegrationCoverageV1(**coverage.model_dump()),
            storage_charge_bases=json.loads(row.storage_charge_bases_json or "[]"),
            subtotal=row.subtotal,
            total=row.total,
            revision=row.revision,
            generated_at=row.generated_at,
            finalized_at=row.finalized_at,
        )

    @staticmethod
    def _statement_line(line_index: int, snapshot_json: str) -> BillingIntegrationStatementLineV1:
        snapshot = BillingStatementLineSnapshot.model_validate_json(snapshot_json)
        quantity = snapshot.priced_storage_quantity
        resolution = snapshot.rate_resolution
        return BillingIntegrationStatementLineV1(
            line_index=line_index,
            subject_type=snapshot.subject_type,
            subject_id=snapshot.subject_id,
            subject_name=snapshot.subject_name,
            rgw_identifier=snapshot.rgw_identifier,
            membership_reasons=[
                BillingIntegrationMembershipReasonV1(**reason.model_dump())
                for reason in snapshot.membership_reasons
            ],
            membership_conflict=snapshot.membership_conflict,
            included_in_total=snapshot.included_in_total,
            storage_endpoint_id=snapshot.storage_endpoint_id,
            storage_endpoint_name=snapshot.storage_endpoint_name,
            usage=BillingIntegrationUsageV1(**snapshot.usage.model_dump()),
            storage=BillingIntegrationStorageV1(
                avg_bytes=snapshot.storage.avg_bytes,
                measured_gib_month=snapshot.storage.avg_gb_month,
                total_objects=snapshot.storage.total_objects,
            ),
            coverage=BillingIntegrationLineCoverageV1(**snapshot.coverage.model_dump()),
            storage_charge_basis=snapshot.storage_charge_basis,
            priced_storage_quantity=(
                BillingIntegrationPricedStorageQuantityV1(**quantity.model_dump())
                if quantity is not None
                else None
            ),
            rate_resolution=BillingIntegrationRateResolutionV1(**resolution.model_dump()),
            unit_prices=BillingIntegrationUnitPricesV1(**snapshot.unit_prices.model_dump()),
            amounts=BillingIntegrationAmountsV1(**snapshot.amounts.model_dump()),
            complete=snapshot.complete,
            issues=snapshot.issues,
        )

    @staticmethod
    def _currency_total(item) -> BillingIntegrationCurrencyTotalV1:
        return BillingIntegrationCurrencyTotalV1(**item.model_dump())

    @staticmethod
    def _encode_cursor(period_start: date, statement_id: int) -> str:
        raw = json.dumps(
            {"period_start": period_start.isoformat(), "id": statement_id},
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
        return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

    @staticmethod
    def _decode_cursor(cursor: str) -> tuple[date, int]:
        try:
            padded = cursor + "=" * (-len(cursor) % 4)
            payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
            cursor_period = date.fromisoformat(str(payload["period_start"]))
            cursor_id = int(payload["id"])
        except (
            ValueError,
            TypeError,
            KeyError,
            UnicodeDecodeError,
            binascii.Error,
            json.JSONDecodeError,
        ) as exc:
            raise ValueError("Invalid pagination cursor") from exc
        if cursor_id <= 0:
            raise ValueError("Invalid pagination cursor")
        return cursor_period, cursor_id

    @staticmethod
    def _decimal_text(value: Optional[object]) -> str:
        return "" if value is None else str(value)
