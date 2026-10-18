# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import BillingEntity
from app.models.billing import (
    BillingAnalysisCoverage,
    BillingAnalysisCurrencyTotal,
    BillingAnalysisPreview,
    BillingEntityAnalysisLine,
    BillingEntityAnalysisPreview,
    BillingEntityGroupAnalysisPreview,
    BillingEntityGroupPreviewAmount,
)
from app.services.billing_calculation import coverage_ratio
from app.services.billing_entity_group_service import BillingEntityGroupService
from app.services.billing_entity_service import BillingEntityService
from app.services.billing_service import BillingService, _parse_month


class BillingAnalysisService:
    """Compose canonical Billing subject results into entity/group previews.

    This service owns allocation and aggregation only. Subject quantities, rates,
    and costs remain calculated by BillingService and its canonical resolvers.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self.billing = BillingService(db)
        self.entities = BillingEntityService(db)
        self.groups = BillingEntityGroupService(db)

    def preview(self, month: str) -> BillingAnalysisPreview:
        period = _parse_month(month)
        resolution = self.entities.resolve_all()

        scopes = sorted(
            {
                (member.storage_endpoint_id, entity.subject_type)
                for entity in resolution.entities
                for member in entity.members
            }
        )
        subject_rows = {
            (row.subject_type, row.subject_id): row
            for endpoint_id, subject_type in scopes
            for row in self.billing.analysis_subjects(
                period.month,
                endpoint_id,
                subject_type,
            )
        }
        conflict_keys = {
            (conflict.subject.subject_type, conflict.subject.subject_id)
            for conflict in resolution.conflicts
        }
        entity_ids = [
            item.entity_id
            for item in resolution.entities
            if item.entity_id is not None
        ]
        entity_rows = {
            row.id: row
            for row in self.db.scalars(
                select(BillingEntity).where(BillingEntity.id.in_(entity_ids))
            ).all()
        } if entity_ids else {}

        entity_previews: list[BillingEntityAnalysisPreview] = []
        for entity in resolution.entities:
            if entity.entity_id is None:
                continue
            entity_row = entity_rows.get(entity.entity_id)
            lines: list[BillingEntityAnalysisLine] = []
            entity_issues: set[str] = set()
            currency_amounts: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
            currency_complete: dict[str, bool] = defaultdict(lambda: True)
            storage_bases: set[str] = set()

            for member in entity.members:
                subject = subject_rows.get((member.subject_type, member.subject_id))
                if subject is None:
                    entity_issues.add("subject_data_missing")
                    continue

                membership_conflict = (member.subject_type, member.subject_id) in conflict_keys
                issues = set(subject.rate_resolution.issues)
                if membership_conflict:
                    issues.add("billing_entity_membership_conflict")
                if (subject.coverage.storage_days_collected or 0) < period.days_in_month:
                    issues.add("incomplete_storage_coverage")
                if (subject.coverage.usage_days_collected or 0) < period.days_in_month:
                    issues.add("incomplete_usage_coverage")
                if subject.cost is None or subject.cost.total_cost is None:
                    issues.add("cost_unavailable")
                if subject.cost and subject.cost.storage_quantity:
                    storage_bases.add(subject.cost.storage_quantity.basis)
                    issues.update(subject.cost.storage_quantity.issues)

                line_complete = (
                    not membership_conflict
                    and subject.rate_resolution.status == "resolved"
                    and subject.cost is not None
                    and subject.cost.total_cost is not None
                    and subject.cost.complete
                    and (subject.coverage.storage_days_collected or 0) == period.days_in_month
                    and (subject.coverage.usage_days_collected or 0) == period.days_in_month
                )
                included_in_total = not membership_conflict
                if (
                    included_in_total
                    and subject.cost is not None
                    and subject.cost.total_cost is not None
                    and subject.cost.currency
                ):
                    currency = subject.cost.currency.upper()
                    currency_amounts[currency] += subject.cost.total_cost
                    currency_complete[currency] = currency_complete[currency] and line_complete

                lines.append(
                    BillingEntityAnalysisLine(
                        billing_entity_id=entity.entity_id,
                        billing_entity_name=entity.entity_name,
                        subject_type=member.subject_type,
                        subject_id=member.subject_id,
                        subject_name=member.name,
                        rgw_identifier=member.rgw_identifier,
                        storage_endpoint_id=member.storage_endpoint_id,
                        storage_endpoint_name=member.storage_endpoint_name,
                        membership_reasons=member.reasons,
                        membership_conflict=membership_conflict,
                        included_in_total=included_in_total,
                        usage=subject.usage,
                        storage=subject.storage,
                        coverage=subject.coverage,
                        cost=subject.cost,
                        rate_resolution=subject.rate_resolution,
                        complete=line_complete,
                        issues=sorted(issues),
                    )
                )
                entity_issues.update(issues)

            if not entity.members:
                entity_issues.add("no_members")

            analysis_coverage = self._coverage(lines, period.days_in_month, len(entity.members))
            conflict_count = sum(1 for line in lines if line.membership_conflict)
            entity_complete = bool(entity.members) and not entity_issues
            currency_totals = [
                BillingAnalysisCurrencyTotal(
                    currency=currency,
                    total_cost=amount,
                    complete=entity_complete and currency_complete[currency],
                )
                for currency, amount in sorted(currency_amounts.items())
            ]
            entity_previews.append(
                BillingEntityAnalysisPreview(
                    billing_entity_id=entity.entity_id,
                    billing_entity_name=entity.entity_name,
                    billing_entity_code=entity_row.code if entity_row is not None else None,
                    subject_type=entity.subject_type,
                    member_count=len(entity.members),
                    conflict_count=conflict_count,
                    currency_totals=currency_totals,
                    storage_charge_bases=sorted(storage_bases),
                    coverage=analysis_coverage,
                    complete=entity_complete,
                    issues=sorted(entity_issues),
                    lines=sorted(
                        lines,
                        key=lambda line: (
                            line.storage_endpoint_name.casefold(),
                            line.subject_name.casefold(),
                            line.subject_id,
                        ),
                    ),
                )
            )

        group_amounts = [
            BillingEntityGroupPreviewAmount(
                billing_entity_id=entity.billing_entity_id,
                currency=total.currency,
                total_cost=total.total_cost,
                complete=entity.complete and total.complete,
            )
            for entity in entity_previews
            for total in entity.currency_totals
        ]
        group_previews: list[BillingEntityGroupAnalysisPreview] = []
        entity_preview_by_id = {
            entity.billing_entity_id: entity
            for entity in entity_previews
        }
        for group in self.groups.list(include_inactive=True):
            aggregate = self.groups.aggregate_preview(
                group.id,
                month=period.month,
                entity_amounts=group_amounts,
            )
            if not group.active and not aggregate.member_entity_ids:
                continue
            member_previews = [
                entity_preview_by_id[entity_id]
                for entity_id in aggregate.member_entity_ids
                if entity_id in entity_preview_by_id
            ]
            group_lines = [
                line
                for entity in member_previews
                for line in entity.lines
            ]
            group_member_count = sum(entity.member_count for entity in member_previews)
            group_issues = {
                issue
                for entity in member_previews
                for issue in entity.issues
            }
            if aggregate.missing_entity_ids:
                group_issues.add("missing_billing_entity_analysis")
            group_previews.append(
                BillingEntityGroupAnalysisPreview(
                    billing_entity_group_id=group.id,
                    billing_entity_group_name=group.name,
                    billing_entity_group_code=group.code,
                    active=group.active,
                    member_entity_ids=aggregate.member_entity_ids,
                    currency_totals=aggregate.currency_totals,
                    missing_entity_ids=aggregate.missing_entity_ids,
                    conflict_count=sum(entity.conflict_count for entity in member_previews),
                    storage_charge_bases=sorted(
                        {
                            basis
                            for entity in member_previews
                            for basis in entity.storage_charge_bases
                        }
                    ),
                    coverage=self._coverage(
                        group_lines,
                        period.days_in_month,
                        group_member_count,
                    ),
                    complete=aggregate.complete,
                    issues=sorted(group_issues),
                )
            )

        return BillingAnalysisPreview(
            month=period.month,
            days_in_month=period.days_in_month,
            entities=entity_previews,
            groups=group_previews,
            unassigned=resolution.unassigned,
            conflicts=resolution.conflicts,
        )

    @staticmethod
    def _coverage(
        lines: list[BillingEntityAnalysisLine],
        days_in_month: int,
        member_count: int,
    ) -> BillingAnalysisCoverage:
        expected = days_in_month * member_count
        storage_observations = sum(line.coverage.storage_days_collected or 0 for line in lines)
        usage_observations = sum(line.coverage.usage_days_collected or 0 for line in lines)
        quota_lines = [
            line.cost.storage_quantity
            for line in lines
            if line.cost is not None
            and line.cost.storage_quantity is not None
            and line.cost.storage_quantity.basis == "allocated_quota"
        ]
        quota_collected = sum(quantity.observations_collected for quantity in quota_lines)
        quota_expected = sum(quantity.observations_expected for quantity in quota_lines)
        return BillingAnalysisCoverage(
            member_count=member_count,
            expected_daily_observations=expected,
            storage_observations=storage_observations,
            usage_observations=usage_observations,
            storage_coverage_ratio=coverage_ratio(storage_observations, expected),
            usage_coverage_ratio=coverage_ratio(usage_observations, expected),
            quota_observations_collected=quota_collected,
            quota_observations_expected=quota_expected,
            quota_coverage_ratio=(
                coverage_ratio(quota_collected, quota_expected)
                if quota_expected > 0
                else None
            ),
        )
