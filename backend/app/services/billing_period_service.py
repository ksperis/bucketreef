# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import (
    BillingEntity,
    BillingEntityGroup,
    BillingStatement,
)
from app.models.billing import (
    BillingFinalizedPeriodAggregation,
    BillingFinalizedPeriodCurrencyTotal,
    BillingFinalizedPeriodEntityContribution,
    BillingFinalizedPeriodMonth,
    BillingStatementLineSnapshot,
)
from app.services.billing_calculation import monetary_total
from app.services.billing_service import _parse_month


class BillingPeriodScopeNotFoundError(ValueError):
    pass


def _next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _month_range(start_month: str, end_month: str) -> list[date]:
    start = _parse_month(start_month).start
    end = _parse_month(end_month).start
    if end < start:
        raise ValueError("end_month must not be before start_month")
    values: list[date] = []
    current = start
    while current <= end:
        values.append(current)
        current = _next_month(current)
    return values


class BillingFinalizedPeriodService:
    """Aggregate persisted finalized monthly statements without re-rating history."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def aggregate(
        self,
        *,
        scope_type: str,
        scope_id: int,
        start_month: str,
        end_month: str,
    ) -> BillingFinalizedPeriodAggregation:
        normalized_scope = scope_type.strip().lower()
        if normalized_scope not in {"entity", "group"}:
            raise ValueError("scope_type must be 'entity' or 'group'")
        month_starts = _month_range(start_month, end_month)

        if normalized_scope == "entity":
            entity = self.db.get(BillingEntity, scope_id)
            if entity is None:
                raise BillingPeriodScopeNotFoundError("Billing Entity not found")
            scope_name = entity.name
            scope_code = entity.code
            scope_external_id = entity.external_id
            members_by_month = {month: [entity.id] for month in month_starts}
        else:
            group = self.db.scalar(
                select(BillingEntityGroup)
                .where(BillingEntityGroup.id == scope_id)
                .options(selectinload(BillingEntityGroup.memberships))
            )
            if group is None:
                raise BillingPeriodScopeNotFoundError("Billing Group not found")
            scope_name = group.name
            scope_code = group.code
            scope_external_id = group.external_id
            members_by_month = {
                month: sorted(
                    {
                        membership.billing_entity_id
                        for membership in group.memberships
                        if membership.effective_from <= month
                        and (membership.effective_to is None or membership.effective_to >= month)
                    }
                )
                for month in month_starts
            }

        relevant_entity_ids = sorted({entity_id for ids in members_by_month.values() for entity_id in ids})
        rows_by_month_entity: dict[tuple[date, int], list[BillingStatement]] = defaultdict(list)
        if relevant_entity_ids:
            rows = self.db.scalars(
                select(BillingStatement)
                .where(
                    BillingStatement.period_start >= month_starts[0],
                    BillingStatement.period_start <= month_starts[-1],
                    BillingStatement.billing_entity_id.in_(relevant_entity_ids),
                )
                .options(selectinload(BillingStatement.lines))
                .order_by(
                    BillingStatement.period_start.asc(),
                    BillingStatement.billing_entity_id.asc(),
                    BillingStatement.currency.asc(),
                    BillingStatement.id.asc(),
                )
            ).unique().all()
            for row in rows:
                rows_by_month_entity[(row.period_start, row.billing_entity_id)].append(row)

        month_results: list[BillingFinalizedPeriodMonth] = []
        finalized_months: list[str] = []
        missing_months: list[str] = []
        unfinalized_months: list[str] = []
        period_rows: list[BillingStatement] = []

        for month in month_starts:
            member_ids = members_by_month[month]
            finalized_entity_ids: list[int] = []
            missing_entity_ids: list[int] = []
            unfinalized_entity_ids: list[int] = []
            finalized_rows: list[BillingStatement] = []

            for entity_id in member_ids:
                entity_rows = rows_by_month_entity.get((month, entity_id), [])
                if not entity_rows:
                    missing_entity_ids.append(entity_id)
                    continue
                if any(row.status != "finalized" for row in entity_rows):
                    unfinalized_entity_ids.append(entity_id)
                if all(row.status == "finalized" for row in entity_rows):
                    finalized_entity_ids.append(entity_id)
                finalized_rows.extend(row for row in entity_rows if row.status == "finalized")

            complete = not missing_entity_ids and not unfinalized_entity_ids
            month_label = month.strftime("%Y-%m")
            if complete:
                finalized_months.append(month_label)
            if missing_entity_ids:
                missing_months.append(month_label)
            if unfinalized_entity_ids:
                unfinalized_months.append(month_label)

            period_rows.extend(finalized_rows)
            entity_contributions: list[BillingFinalizedPeriodEntityContribution] = []
            for entity_id in sorted({row.billing_entity_id for row in finalized_rows}):
                entity_rows = [row for row in finalized_rows if row.billing_entity_id == entity_id]
                representative = entity_rows[0]
                entity_contributions.append(
                    BillingFinalizedPeriodEntityContribution(
                        billing_entity_id=entity_id,
                        billing_entity_name=representative.billing_entity_name,
                        billing_entity_code=representative.billing_entity_code,
                        billing_entity_external_id=representative.billing_entity_external_id,
                        statement_ids=sorted(row.id for row in entity_rows),
                        currency_totals=self._currency_totals(entity_rows),
                    )
                )
            month_results.append(
                BillingFinalizedPeriodMonth(
                    month=month_label,
                    member_entity_ids=member_ids,
                    finalized_entity_ids=sorted(finalized_entity_ids),
                    missing_entity_ids=sorted(missing_entity_ids),
                    unfinalized_entity_ids=sorted(unfinalized_entity_ids),
                    statement_ids=sorted(row.id for row in finalized_rows),
                    currency_totals=self._currency_totals(finalized_rows),
                    entity_contributions=entity_contributions,
                    complete=complete,
                )
            )

        expected_months = [month.strftime("%Y-%m") for month in month_starts]
        return BillingFinalizedPeriodAggregation(
            scope_type=normalized_scope,
            scope_id=scope_id,
            scope_name=scope_name,
            scope_code=scope_code,
            scope_external_id=scope_external_id,
            start_month=expected_months[0],
            end_month=expected_months[-1],
            expected_months=expected_months,
            finalized_months=finalized_months,
            missing_months=missing_months,
            unfinalized_months=unfinalized_months,
            currency_totals=self._currency_totals(period_rows),
            months=month_results,
            complete=len(finalized_months) == len(expected_months),
        )

    @staticmethod
    def _currency_totals(rows: list[BillingStatement]) -> list[BillingFinalizedPeriodCurrencyTotal]:
        by_currency: dict[str, list[BillingStatement]] = defaultdict(list)
        for row in rows:
            by_currency[row.currency].append(row)

        results: list[BillingFinalizedPeriodCurrencyTotal] = []
        for currency in sorted(by_currency):
            currency_rows = by_currency[currency]
            storage_amounts: list[Decimal] = []
            egress_amounts: list[Decimal] = []
            ingress_amounts: list[Decimal] = []
            request_amounts: list[Decimal] = []
            storage_bases: set[str] = set()
            for row in currency_rows:
                for line in row.lines:
                    snapshot = BillingStatementLineSnapshot.model_validate_json(line.snapshot_json)
                    amounts = snapshot.amounts
                    if amounts.storage_cost is not None:
                        storage_amounts.append(amounts.storage_cost)
                    if amounts.egress_cost is not None:
                        egress_amounts.append(amounts.egress_cost)
                    if amounts.ingress_cost is not None:
                        ingress_amounts.append(amounts.ingress_cost)
                    if amounts.requests_cost is not None:
                        request_amounts.append(amounts.requests_cost)
                    if snapshot.storage_charge_basis is not None:
                        storage_bases.add(snapshot.storage_charge_basis)

            results.append(
                BillingFinalizedPeriodCurrencyTotal(
                    currency=currency,
                    storage_cost=monetary_total(storage_amounts) or Decimal("0.000000"),
                    egress_cost=monetary_total(egress_amounts) or Decimal("0.000000"),
                    ingress_cost=monetary_total(ingress_amounts) or Decimal("0.000000"),
                    requests_cost=monetary_total(request_amounts) or Decimal("0.000000"),
                    total=monetary_total([row.total for row in currency_rows]) or Decimal("0.000000"),
                    statement_ids=sorted(row.id for row in currency_rows),
                    statement_public_ids=sorted(row.public_id for row in currency_rows),
                    statement_months=sorted({row.period_start.strftime("%Y-%m") for row in currency_rows}),
                    storage_charge_bases=sorted(storage_bases),
                )
            )
        return results
