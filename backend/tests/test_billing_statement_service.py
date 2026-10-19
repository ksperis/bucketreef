from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.db import (
    BillingAssignment,
    BillingEntity,
    BillingEntityRateAssignment,
    BillingRateCard,
    BillingRatePlan,
    BillingStatement,
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    StorageEndpoint,
    User,
    UserRole,
)
from app.models.billing import BillingEntityPayload
from app.services.billing_entity_service import BillingEntityService
from app.services.billing_statement_service import (
    BillingStatementBlockedError,
    BillingStatementImmutableError,
    BillingStatementService,
    BillingStatementStaleError,
)
from app.utils.time import utcnow


GIB = 1024**3


def _endpoint(db_session, name: str = "statement-endpoint") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint


def _account(db_session, endpoint: StorageEndpoint, name: str = "statement-account") -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=f"RGW-{name}",
        rgw_user_uid=f"RGW-{name}-root",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    return account


def _plan(
    db_session,
    *,
    name: str = "statement-plan",
    currency: str = "EUR",
    basis: str = "actual_usage",
    storage_price: str = "1",
) -> BillingRatePlan:
    plan = BillingRatePlan(name=name, storage_endpoint_id=None)
    card = BillingRateCard(
        rate_plan=plan,
        currency=currency,
        storage_charge_basis=basis,
        storage_gb_month_price=Decimal(storage_price),
        egress_gb_price=Decimal("0.1"),
        ingress_gb_price=Decimal("0.01"),
        requests_per_1000_price=Decimal("0.001"),
        effective_from=date(2026, 1, 1),
    )
    db_session.add(card)
    db_session.commit()
    return plan


def _entity(db_session, account: S3Account, plan: BillingRatePlan | None = None):
    item = BillingEntityService(db_session).create(
        BillingEntityPayload(
            name=f"Entity {account.name}",
            code=f"E-{account.id}",
            external_id=f"cost-center-{account.id}",
            subject_type="account",
            explicit_include_ids=[account.id],
        )
    )
    if plan is not None:
        db_session.add(
            BillingEntityRateAssignment(
                billing_entity_id=item.id,
                rate_plan_id=plan.id,
                effective_from=date(2026, 1, 1),
            )
        )
        db_session.commit()
    return BillingEntityService(db_session).get(item.id)


def _month_data(
    db_session,
    endpoint: StorageEndpoint,
    account: S3Account,
    *,
    measured_gib: int = 1,
    quota_gib: int = 2,
) -> None:
    rows = []
    for offset in range(31):
        day = date(2026, 1, 1) + timedelta(days=offset)
        rows.extend(
            [
                BillingStorageDaily(
                    day=day,
                    storage_endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    total_bytes=measured_gib * GIB,
                    total_objects=10,
                    quota_size_bytes=quota_gib * GIB,
                    quota_state="valid",
                    source="rgw_admin_bucket_stats",
                    collected_at=utcnow(),
                ),
                BillingUsageDaily(
                    day=day,
                    storage_endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    bytes_in=GIB,
                    bytes_out=2 * GIB,
                    ops_total=1000,
                    source="rgw_admin_usage",
                    collected_at=utcnow(),
                ),
            ]
        )
    db_session.add_all(rows)
    db_session.commit()


def _actor() -> User:
    return User(
        id=999,
        email="admin@example.com",
        full_name="Admin",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_SUPERADMIN.value,
    )


def test_statement_generation_is_idempotent_and_regeneration_is_explicit(db_session):
    endpoint = _endpoint(db_session)
    account = _account(db_session, endpoint)
    plan = _plan(db_session)
    entity = _entity(db_session, account, plan)
    _month_data(db_session, endpoint, account)
    service = BillingStatementService(db_session)

    first = service.generate(month="2026-01", billing_entity_id=entity.id)
    assert first.blockers == []
    assert len(first.statements) == 1
    statement = first.statements[0]
    assert statement.status == "draft"
    assert statement.revision == 1
    assert statement.currency == "EUR"
    assert statement.total == Decimal("7.541000")
    assert statement.coverage.storage_coverage_ratio == Decimal("1.000000")
    assert statement.coverage.usage_coverage_ratio == Decimal("1.000000")
    assert len(statement.lines) == 1
    snapshot = statement.lines[0].snapshot
    assert snapshot.membership_reasons[0].kind == "explicit_include"
    assert snapshot.storage_charge_basis == "actual_usage"
    assert snapshot.priced_storage_quantity is not None
    assert snapshot.priced_storage_quantity.quantity_gib_month == Decimal("1.000000000000")
    assert snapshot.unit_prices.storage_gb_month_price == Decimal("1.000000")
    assert snapshot.amounts.storage_cost == Decimal("1.000000")

    repeated = service.generate(month="2026-01", billing_entity_id=entity.id)
    assert repeated.statements[0].id == statement.id
    assert repeated.statements[0].public_id == statement.public_id
    assert repeated.statements[0].revision == 1
    assert db_session.query(BillingStatement).count() == 1

    regenerated = service.generate(
        month="2026-01",
        billing_entity_id=entity.id,
        regenerate=True,
    )
    assert regenerated.statements[0].id == statement.id
    assert regenerated.statements[0].public_id == statement.public_id
    assert regenerated.statements[0].revision == 2
    assert db_session.query(BillingStatement).count() == 1


def test_finalized_statement_is_self_contained_after_live_data_changes(db_session):
    endpoint = _endpoint(db_session, "immutable-endpoint")
    account = _account(db_session, endpoint, "immutable-account")
    plan = _plan(db_session, name="immutable-plan")
    entity = _entity(db_session, account, plan)
    _month_data(db_session, endpoint, account)
    service = BillingStatementService(db_session)

    draft = service.generate(month="2026-01", billing_entity_id=entity.id).statements[0]
    finalized = service.finalize(draft.id, actor=_actor())
    assert finalized.status == "finalized"
    assert finalized.finalized_by_user_email == "admin@example.com"
    original_total = finalized.total
    original_snapshot = finalized.lines[0].snapshot.model_dump(mode="json")

    entity_row = db_session.get(BillingEntity, entity.id)
    assert entity_row is not None
    entity_row.name = "Renamed after finalization"
    card = db_session.query(BillingRateCard).filter_by(rate_plan_id=plan.id).one()
    card.storage_gb_month_price = Decimal("99")
    db_session.query(BillingStorageDaily).delete()
    db_session.query(BillingUsageDaily).delete()
    db_session.commit()

    persisted = service.get(draft.id)
    assert persisted.billing_entity_name == finalized.billing_entity_name
    assert persisted.total == original_total
    assert persisted.lines[0].snapshot.model_dump(mode="json") == original_snapshot
    with pytest.raises(BillingStatementImmutableError):
        service.generate(month="2026-01", billing_entity_id=entity.id, regenerate=True)


def test_quota_statement_snapshots_allocated_capacity_and_survives_quota_removal(db_session):
    endpoint = _endpoint(db_session, "quota-statement-endpoint")
    account = _account(db_session, endpoint, "quota-statement-account")
    plan = _plan(
        db_session,
        name="quota-statement-plan",
        basis="allocated_quota",
        storage_price="1",
    )
    entity = _entity(db_session, account, plan)
    _month_data(db_session, endpoint, account, measured_gib=1, quota_gib=2)
    service = BillingStatementService(db_session)

    draft = service.generate(month="2026-01", billing_entity_id=entity.id).statements[0]
    quantity = draft.lines[0].snapshot.priced_storage_quantity
    assert quantity is not None
    assert quantity.basis == "allocated_quota"
    assert quantity.quantity_gib_month == Decimal("2.000000000000")
    assert draft.lines[0].snapshot.storage.avg_gb_month == Decimal("1.000000000000")
    finalized = service.finalize(draft.id, actor=_actor())

    db_session.query(BillingStorageDaily).delete()
    db_session.commit()
    persisted = service.get(finalized.id)
    persisted_quantity = persisted.lines[0].snapshot.priced_storage_quantity
    assert persisted_quantity is not None
    assert persisted_quantity.quantity_gib_month == Decimal("2.000000000000")
    assert persisted.lines[0].snapshot.storage.avg_gb_month == Decimal("1.000000000000")


def test_finalization_rejects_stale_or_blocked_drafts(db_session):
    endpoint = _endpoint(db_session, "stale-endpoint")
    account = _account(db_session, endpoint, "stale-account")
    plan = _plan(db_session, name="stale-plan")
    entity = _entity(db_session, account, plan)
    _month_data(db_session, endpoint, account)
    service = BillingStatementService(db_session)

    draft = service.generate(month="2026-01", billing_entity_id=entity.id).statements[0]
    card = db_session.query(BillingRateCard).filter_by(rate_plan_id=plan.id).one()
    card.storage_gb_month_price = Decimal("2")
    db_session.commit()
    with pytest.raises(BillingStatementStaleError):
        service.finalize(draft.id, actor=_actor())

    regenerated = service.generate(
        month="2026-01",
        billing_entity_id=entity.id,
        regenerate=True,
    ).statements[0]
    assert regenerated.revision == 2
    assert service.finalize(regenerated.id, actor=_actor()).status == "finalized"

    blocked_endpoint = _endpoint(db_session, "blocked-endpoint")
    blocked_account = _account(db_session, blocked_endpoint, "blocked-account")
    blocked_plan = _plan(
        db_session,
        name="blocked-plan",
        basis="allocated_quota",
    )
    blocked_entity = _entity(db_session, blocked_account, blocked_plan)
    _month_data(db_session, blocked_endpoint, blocked_account)
    missing = db_session.query(BillingStorageDaily).filter_by(s3_account_id=blocked_account.id).first()
    assert missing is not None
    missing.quota_size_bytes = None
    missing.quota_state = "unlimited"
    db_session.commit()

    blocked_result = service.generate(month="2026-01", billing_entity_id=blocked_entity.id)
    assert any("unlimited_quota" in blocker for blocker in blocked_result.blockers)
    blocked_statement = blocked_result.statements[0]
    with pytest.raises(BillingStatementBlockedError):
        service.finalize(blocked_statement.id, actor=_actor())


def test_estimated_statement_extrapolates_usage_and_uses_observed_storage_average(db_session):
    endpoint = _endpoint(db_session, "estimated-endpoint")
    account = _account(db_session, endpoint, "estimated-account")
    plan = _plan(db_session, name="estimated-plan")
    entity = _entity(db_session, account, plan)
    _month_data(db_session, endpoint, account)
    missing_days = [date(2026, 1, 10), date(2026, 1, 20)]
    db_session.query(BillingUsageDaily).filter(
        BillingUsageDaily.s3_account_id == account.id,
        BillingUsageDaily.day.in_(missing_days),
    ).delete(synchronize_session=False)
    db_session.query(BillingStorageDaily).filter(
        BillingStorageDaily.s3_account_id == account.id,
        BillingStorageDaily.day.in_(missing_days),
    ).delete(synchronize_session=False)
    db_session.commit()
    service = BillingStatementService(db_session)

    strict = service.generate(month="2026-01", billing_entity_id=entity.id)
    assert any("incomplete_usage_coverage" in blocker for blocker in strict.blockers)
    assert any("incomplete_storage_coverage" in blocker for blocker in strict.blockers)

    estimated = service.generate(
        month="2026-01",
        billing_entity_id=entity.id,
        regenerate=True,
        estimation_mode="coverage_extrapolation",
        estimation_requested_by_email="admin@example.com",
    ).statements[0]

    assert estimated.blockers == []
    assert estimated.estimation_mode == "coverage_extrapolation"
    assert estimated.estimation_reason == "Incomplete source coverage accepted by administrator"
    assert estimated.estimation_requested_by_email == "admin@example.com"
    assert estimated.coverage.storage_coverage_ratio == Decimal("0.935484")
    assert estimated.coverage.usage_coverage_ratio == Decimal("0.935484")
    assert estimated.total == Decimal("7.541000")
    line = estimated.lines[0].snapshot
    assert line.estimation is not None
    assert line.estimation.usage_extrapolation_factor == Decimal("1.068965517241")
    assert line.estimation.storage_method == "observed_daily_average"
    assert line.priced_storage_quantity is not None
    assert line.priced_storage_quantity.status == "estimated"
    assert line.amounts.storage_cost == Decimal("1.000000")
    assert line.amounts.egress_cost == Decimal("6.200000")
    assert line.amounts.ingress_cost == Decimal("0.310000")
    assert line.amounts.requests_cost == Decimal("0.031000")
    assert service.finalize(estimated.id, actor=_actor()).status == "finalized"


def test_estimated_statement_can_extrapolate_missing_quota_observations_but_not_unlimited_quota(db_session):
    endpoint = _endpoint(db_session, "estimated-quota-endpoint")
    account = _account(db_session, endpoint, "estimated-quota-account")
    plan = _plan(
        db_session,
        name="estimated-quota-plan",
        basis="allocated_quota",
    )
    entity = _entity(db_session, account, plan)
    _month_data(db_session, endpoint, account, quota_gib=2)
    row = db_session.query(BillingStorageDaily).filter_by(
        s3_account_id=account.id,
        day=date(2026, 1, 15),
    ).one()
    row.quota_size_bytes = None
    row.quota_state = "missing"
    db_session.commit()
    service = BillingStatementService(db_session)

    estimated = service.generate(
        month="2026-01",
        billing_entity_id=entity.id,
        estimation_mode="coverage_extrapolation",
        estimation_requested_by_email="admin@example.com",
    ).statements[0]

    assert estimated.blockers == []
    assert estimated.total == Decimal("8.541000")
    line = estimated.lines[0].snapshot
    assert line.estimation is not None
    assert line.estimation.storage_method == "allocated_quota_average"
    assert line.estimation.storage_extrapolation_factor == Decimal("1.033333333333")
    assert line.priced_storage_quantity is not None
    assert line.priced_storage_quantity.status == "estimated"
    assert line.priced_storage_quantity.quantity_gib_month == Decimal("2.000000000000")

    unlimited = db_session.query(BillingStorageDaily).filter_by(
        s3_account_id=account.id,
        day=date(2026, 1, 16),
    ).one()
    unlimited.quota_size_bytes = None
    unlimited.quota_state = "unlimited"
    db_session.commit()
    regenerated = service.generate(
        month="2026-01",
        billing_entity_id=entity.id,
        regenerate=True,
        estimation_mode="coverage_extrapolation",
        estimation_requested_by_email="admin@example.com",
    )
    assert any("unlimited_quota" in blocker for blocker in regenerated.blockers)


def test_generation_reports_unpriced_subject_without_creating_fake_currency(db_session):
    endpoint = _endpoint(db_session, "unpriced-endpoint")
    account = _account(db_session, endpoint, "unpriced-account")
    entity = _entity(db_session, account, plan=None)
    _month_data(db_session, endpoint, account)

    result = BillingStatementService(db_session).generate(
        month="2026-01",
        billing_entity_id=entity.id,
    )

    assert result.statements == []
    assert "no_priced_currency" in result.blockers
    assert any("no_effective_rate_plan" in blocker for blocker in result.blockers)
    assert db_session.query(BillingStatement).count() == 0


def test_entity_with_multiple_currencies_creates_separate_statements(db_session):
    endpoint = _endpoint(db_session, "currency-endpoint")
    eur_account = _account(db_session, endpoint, "currency-eur")
    usd_account = _account(db_session, endpoint, "currency-usd")
    eur_plan = _plan(db_session, name="currency-eur-plan", currency="EUR")
    usd_plan = _plan(db_session, name="currency-usd-plan", currency="USD")
    entity = BillingEntityService(db_session).create(
        BillingEntityPayload(
            name="Multi currency entity",
            code="MULTI-CUR",
            subject_type="account",
            explicit_include_ids=[eur_account.id, usd_account.id],
        )
    )
    db_session.add_all(
        [
            BillingAssignment(
                storage_endpoint_id=endpoint.id,
                s3_account_id=eur_account.id,
                rate_plan_id=eur_plan.id,
                effective_from=date(2026, 1, 1),
            ),
            BillingAssignment(
                storage_endpoint_id=endpoint.id,
                s3_account_id=usd_account.id,
                rate_plan_id=usd_plan.id,
                effective_from=date(2026, 1, 1),
            ),
        ]
    )
    db_session.commit()
    _month_data(db_session, endpoint, eur_account)
    _month_data(db_session, endpoint, usd_account)

    result = BillingStatementService(db_session).generate(
        month="2026-01",
        billing_entity_id=entity.id,
    )

    assert result.blockers == []
    assert [item.currency for item in result.statements] == ["EUR", "USD"]
    assert [item.member_count for item in result.statements] == [1, 1]
    assert all(len(item.lines) == 1 for item in result.statements)
    assert {item.lines[0].snapshot.subject_id for item in result.statements} == {
        eur_account.id,
        usd_account.id,
    }


def test_membership_conflict_is_snapshotted_and_blocks_finalization(db_session):
    endpoint = _endpoint(db_session, "conflict-statement-endpoint")
    account = _account(db_session, endpoint, "conflict-statement-account")
    plan = _plan(db_session, name="conflict-direct-plan")
    first = _entity(db_session, account, plan=None)
    second = BillingEntityService(db_session).create(
        BillingEntityPayload(
            name="Conflicting entity",
            code="CONFLICT-2",
            subject_type="account",
            explicit_include_ids=[account.id],
        )
    )
    db_session.add(
        BillingAssignment(
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            rate_plan_id=plan.id,
            effective_from=date(2026, 1, 1),
        )
    )
    db_session.commit()
    _month_data(db_session, endpoint, account)

    result = BillingStatementService(db_session).generate(
        month="2026-01",
        billing_entity_id=first.id,
    )

    assert len(result.statements) == 1
    statement = result.statements[0]
    assert statement.total == Decimal("0.000000")
    assert statement.lines[0].snapshot.membership_conflict is True
    assert statement.lines[0].snapshot.included_in_total is False
    assert any("billing_entity_membership_conflict" in blocker for blocker in statement.blockers)
    with pytest.raises(BillingStatementBlockedError):
        BillingStatementService(db_session).finalize(statement.id, actor=_actor())
    assert second.id != first.id
