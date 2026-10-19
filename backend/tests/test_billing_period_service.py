from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.db import (
    BillingEntity,
    BillingEntityGroup,
    BillingEntityGroupMembership,
    BillingStatement,
    BillingStatementLine,
)
from app.models.billing import (
    BillingAnalysisCoverage,
    BillingCoverage,
    BillingRateResolutionExplanation,
    BillingStatementComponentAmounts,
    BillingStatementLineSnapshot,
    BillingStatementUnitPrices,
    BillingStorageChargeQuantity,
    BillingStorageTotals,
    BillingUsageTotals,
)
from app.services.billing_period_service import BillingFinalizedPeriodService
from app.utils.time import utcnow


def _entity(db_session, name: str) -> BillingEntity:
    row = BillingEntity(
        name=name,
        code=name.upper(),
        external_id=f"ext-{name}",
        subject_type="account",
        active=True,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(row)
    db_session.flush()
    return row


def _statement(
    db_session,
    entity: BillingEntity,
    month: date,
    *,
    currency: str = "EUR",
    total: str = "1",
    status: str = "finalized",
    basis: str = "actual_usage",
) -> BillingStatement:
    amount = Decimal(total)
    now = utcnow()
    coverage = BillingAnalysisCoverage(
        member_count=1,
        expected_daily_observations=31,
        storage_observations=31,
        usage_observations=31,
        storage_coverage_ratio=Decimal("1"),
        usage_coverage_ratio=Decimal("1"),
        quota_observations_collected=31 if basis == "allocated_quota" else 0,
        quota_observations_expected=31 if basis == "allocated_quota" else 0,
        quota_coverage_ratio=Decimal("1") if basis == "allocated_quota" else None,
    )
    row = BillingStatement(
        public_id=str(uuid4()),
        billing_entity_id=entity.id,
        billing_entity_name=entity.name,
        billing_entity_code=entity.code,
        billing_entity_external_id=entity.external_id,
        subject_type="account",
        period_start=month,
        period_end=date(month.year, month.month, 28),
        currency=currency,
        status=status,
        member_count=1,
        coverage_json=coverage.model_dump_json(),
        blockers_json="[]",
        storage_charge_bases_json=f'["{basis}"]',
        subtotal=amount,
        total=amount,
        source_fingerprint="a" * 64,
        revision=1,
        generated_at=now,
        finalized_at=now if status == "finalized" else None,
        created_at=now,
        updated_at=now,
    )
    db_session.add(row)
    db_session.flush()
    snapshot = BillingStatementLineSnapshot(
        subject_type="account",
        subject_id=entity.id,
        subject_name=f"Subject {entity.id}",
        rgw_identifier=f"RGW-{entity.id}",
        membership_reasons=[],
        membership_conflict=False,
        included_in_total=True,
        storage_endpoint_id=1,
        storage_endpoint_name="Endpoint",
        usage=BillingUsageTotals(bytes_in=0, bytes_out=0, ops_total=0),
        storage=BillingStorageTotals(avg_bytes=1024**3, avg_gb_month=Decimal("1"), total_objects=1),
        coverage=BillingCoverage(
            days_collected=31,
            days_in_month=31,
            coverage_ratio=1,
            storage_days_collected=31,
            usage_days_collected=31,
        ),
        storage_charge_basis=basis,
        priced_storage_quantity=BillingStorageChargeQuantity(
            basis=basis,
            quantity_gib_month=Decimal("1"),
            observations_collected=31,
            observations_expected=31,
            calendar_days=31,
            coverage_ratio=Decimal("1"),
            status="complete",
            issues=[],
        ),
        rate_resolution=BillingRateResolutionExplanation(
            status="resolved",
            layer="billing_entity",
            rate_plan_id=1,
            rate_plan_name="Plan",
            rate_card_id=1,
            billing_entity_id=entity.id,
            billing_entity_name=entity.name,
            currency=currency,
            storage_charge_basis=basis,
        ),
        unit_prices=BillingStatementUnitPrices(storage_gb_month_price=amount),
        amounts=BillingStatementComponentAmounts(storage_cost=amount, total_cost=amount),
        complete=True,
        issues=[],
    )
    db_session.add(
        BillingStatementLine(
            billing_statement_id=row.id,
            line_index=1,
            subject_type="account",
            subject_id=entity.id,
            subject_name=f"Subject {entity.id}",
            rgw_identifier=f"RGW-{entity.id}",
            storage_endpoint_id=1,
            storage_endpoint_name="Endpoint",
            currency=currency,
            storage_charge_basis=basis,
            total_cost=amount,
            complete=True,
            snapshot_json=snapshot.model_dump_json(),
            created_at=now,
        )
    )
    db_session.commit()
    return row


def test_entity_calendar_year_aggregates_finalized_monthly_statements(db_session):
    entity = _entity(db_session, "research")
    for month in range(1, 13):
        _statement(db_session, entity, date(2026, month, 1), total="1")

    result = BillingFinalizedPeriodService(db_session).aggregate(
        scope_type="entity",
        scope_id=entity.id,
        start_month="2026-01",
        end_month="2026-12",
    )

    assert result.complete is True
    assert len(result.expected_months) == 12
    assert result.finalized_months == result.expected_months
    assert result.missing_months == []
    assert result.unfinalized_months == []
    assert len(result.currency_totals) == 1
    assert result.currency_totals[0].currency == "EUR"
    assert result.currency_totals[0].total == Decimal("12.000000")
    assert result.currency_totals[0].storage_cost == Decimal("12.000000")
    assert len(result.currency_totals[0].statement_ids) == 12


def test_entity_range_reports_missing_and_unfinalized_months_without_zero_fill(db_session):
    entity = _entity(db_session, "platform")
    _statement(db_session, entity, date(2026, 1, 1), total="4")
    _statement(db_session, entity, date(2026, 2, 1), total="9", status="draft")

    result = BillingFinalizedPeriodService(db_session).aggregate(
        scope_type="entity",
        scope_id=entity.id,
        start_month="2026-01",
        end_month="2026-03",
    )

    assert result.complete is False
    assert result.finalized_months == ["2026-01"]
    assert result.unfinalized_months == ["2026-02"]
    assert result.missing_months == ["2026-03"]
    assert result.currency_totals[0].total == Decimal("4.000000")
    assert result.months[1].currency_totals == []
    assert result.months[2].currency_totals == []


def test_group_aggregation_uses_month_effective_membership_and_keeps_currencies_separate(db_session):
    first = _entity(db_session, "first")
    second = _entity(db_session, "second")
    group = BillingEntityGroup(
        name="DSI",
        code="DSI",
        external_id="dsi",
        active=True,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db_session.add(group)
    db_session.flush()
    db_session.add_all(
        [
            BillingEntityGroupMembership(
                billing_entity_group_id=group.id,
                billing_entity_id=first.id,
                effective_from=date(2026, 1, 1),
                effective_to=date(2026, 1, 31),
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
            BillingEntityGroupMembership(
                billing_entity_group_id=group.id,
                billing_entity_id=second.id,
                effective_from=date(2026, 2, 1),
                effective_to=None,
                created_at=utcnow(),
                updated_at=utcnow(),
            ),
        ]
    )
    db_session.commit()
    _statement(db_session, first, date(2026, 1, 1), currency="EUR", total="2")
    _statement(db_session, second, date(2026, 2, 1), currency="USD", total="3", basis="allocated_quota")

    result = BillingFinalizedPeriodService(db_session).aggregate(
        scope_type="group",
        scope_id=group.id,
        start_month="2026-01",
        end_month="2026-02",
    )

    assert result.complete is True
    assert result.months[0].member_entity_ids == [first.id]
    assert result.months[1].member_entity_ids == [second.id]
    assert result.months[0].entity_contributions[0].billing_entity_name == "first"
    assert result.months[0].entity_contributions[0].statement_ids == [result.months[0].statement_ids[0]]
    assert result.months[1].entity_contributions[0].billing_entity_name == "second"
    assert [(total.currency, total.total) for total in result.currency_totals] == [
        ("EUR", Decimal("2.000000")),
        ("USD", Decimal("3.000000")),
    ]
    assert result.currency_totals[0].storage_charge_bases == ["actual_usage"]
    assert result.currency_totals[1].storage_charge_bases == ["allocated_quota"]
