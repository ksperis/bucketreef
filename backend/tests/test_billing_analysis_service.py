from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from app.db import (
    BillingEntityRateAssignment,
    BillingRateCard,
    BillingRatePlan,
    BillingStorageDaily,
    BillingUsageDaily,
    S3Account,
    StorageEndpoint,
)
from app.models.billing import (
    BillingEntityGroupMembershipInput,
    BillingEntityGroupPayload,
    BillingEntityPayload,
)
from app.services.billing_analysis_service import BillingAnalysisService
from app.services.billing_entity_group_service import BillingEntityGroupService
from app.services.billing_entity_service import BillingEntityService
from app.utils.time import utcnow


GIB = 1024**3


def _endpoint(db_session, name: str) -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint


def _account(db_session, endpoint: StorageEndpoint, name: str) -> S3Account:
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


def _rate_plan(
    db_session,
    *,
    name: str,
    currency: str,
    basis: str = "actual_usage",
    storage_price: str = "1",
) -> BillingRatePlan:
    plan = BillingRatePlan(name=name, storage_endpoint_id=None)
    card = BillingRateCard(
        rate_plan=plan,
        currency=currency,
        storage_charge_basis=basis,
        storage_gb_month_price=Decimal(storage_price),
        effective_from=date(2026, 1, 1),
    )
    db_session.add(card)
    db_session.commit()
    return plan


def _entity(
    db_session,
    *,
    name: str,
    account_ids: list[int],
    rate_plan_id: int,
):
    entity = BillingEntityService(db_session).create(
        BillingEntityPayload(
            name=name,
            code=name.upper().replace(" ", "-"),
            subject_type="account",
            explicit_include_ids=account_ids,
        )
    )
    # Historical analysis fixtures deliberately bypass the create-time guard
    # that prevents an operator from introducing a new backdated assignment.
    # Persisting the historical row directly keeps that production invariant
    # intact while exercising preview behavior for an already-existing period.
    db_session.add(
        BillingEntityRateAssignment(
            billing_entity_id=entity.id,
            rate_plan_id=rate_plan_id,
            effective_from=date(2026, 1, 1),
        )
    )
    db_session.commit()
    return BillingEntityService(db_session).get(entity.id)


def _group(db_session, name: str, entity_ids: list[int]):
    return BillingEntityGroupService(db_session).create(
        BillingEntityGroupPayload(
            name=name,
            memberships=[
                BillingEntityGroupMembershipInput(
                    billing_entity_id=entity_id,
                    effective_from=date(2026, 1, 1),
                )
                for entity_id in entity_ids
            ],
        )
    )


def _month_data(
    db_session,
    endpoint: StorageEndpoint,
    account: S3Account,
    *,
    measured_gib: int = 1,
    quota_gib: int = 2,
    unusable_quota_day: int | None = None,
) -> None:
    start = date(2026, 1, 1)
    rows = []
    for offset in range(31):
        day = start + timedelta(days=offset)
        quota_state = "unlimited" if unusable_quota_day == offset + 1 else "valid"
        quota_bytes = None if quota_state == "unlimited" else quota_gib * GIB
        rows.extend(
            [
                BillingStorageDaily(
                    day=day,
                    storage_endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    total_bytes=measured_gib * GIB,
                    total_objects=10,
                    quota_size_bytes=quota_bytes,
                    quota_state=quota_state,
                    source="rgw_admin_bucket_stats",
                    collected_at=utcnow(),
                ),
                BillingUsageDaily(
                    day=day,
                    storage_endpoint_id=endpoint.id,
                    s3_account_id=account.id,
                    bytes_in=0,
                    bytes_out=0,
                    ops_total=0,
                    source="rgw_admin_usage",
                    collected_at=utcnow(),
                ),
            ]
        )
    db_session.add_all(rows)
    db_session.commit()


def test_entity_analysis_consolidates_endpoints_and_group_without_repricing(db_session):
    first_endpoint = _endpoint(db_session, "analysis-a")
    second_endpoint = _endpoint(db_session, "analysis-b")
    first = _account(db_session, first_endpoint, "research-a")
    second = _account(db_session, second_endpoint, "research-b")
    unassigned = _account(db_session, first_endpoint, "unassigned")
    plan = _rate_plan(db_session, name="research-plan", currency="EUR")
    entity = _entity(
        db_session,
        name="Research",
        account_ids=[first.id, second.id],
        rate_plan_id=plan.id,
    )
    group = _group(db_session, "DSI", [entity.id])
    _month_data(db_session, first_endpoint, first)
    _month_data(db_session, second_endpoint, second)

    result = BillingAnalysisService(db_session).preview("2026-01")

    assert result.month == "2026-01"
    assert result.days_in_month == 31
    assert {(item.subject_type, item.subject_id) for item in result.unassigned} == {
        ("account", unassigned.id)
    }
    preview = result.entities[0]
    assert preview.billing_entity_id == entity.id
    assert preview.member_count == 2
    assert preview.conflict_count == 0
    assert preview.storage_charge_bases == ["actual_usage"]
    assert preview.complete is True
    assert [(item.currency, item.total_cost, item.complete) for item in preview.currency_totals] == [
        ("EUR", Decimal("2.000000"), True)
    ]
    assert {line.storage_endpoint_id for line in preview.lines} == {
        first_endpoint.id,
        second_endpoint.id,
    }
    assert all(line.rate_resolution.layer == "billing_entity" for line in preview.lines)
    assert all(line.storage.avg_gb_month == Decimal("1.000000000000") for line in preview.lines)
    assert preview.coverage.storage_observations == 62
    assert preview.coverage.usage_observations == 62
    assert preview.coverage.storage_coverage_ratio == Decimal("1.000000")

    group_preview = result.groups[0]
    assert group_preview.billing_entity_group_id == group.id
    assert group_preview.member_entity_ids == [entity.id]
    assert [(item.currency, item.total_cost, item.billing_entity_ids, item.complete) for item in group_preview.currency_totals] == [
        ("EUR", Decimal("2.000000"), [entity.id], True)
    ]
    assert group_preview.coverage.storage_observations == 62
    assert group_preview.coverage.usage_observations == 62
    assert group_preview.coverage.storage_coverage_ratio == Decimal("1.000000")
    assert group_preview.storage_charge_bases == ["actual_usage"]
    assert group_preview.conflict_count == 0
    assert group_preview.complete is True


def test_entity_analysis_excludes_membership_conflicts_from_totals(db_session):
    endpoint = _endpoint(db_session, "analysis-conflict")
    account = _account(db_session, endpoint, "shared")
    plan = _rate_plan(db_session, name="shared-plan", currency="EUR")
    first = _entity(db_session, name="Entity A", account_ids=[account.id], rate_plan_id=plan.id)
    second = _entity(db_session, name="Entity B", account_ids=[account.id], rate_plan_id=plan.id)
    _month_data(db_session, endpoint, account)

    result = BillingAnalysisService(db_session).preview("2026-01")

    assert len(result.conflicts) == 1
    assert result.conflicts[0].subject.subject_id == account.id
    previews = {item.billing_entity_id: item for item in result.entities}
    for entity_id in (first.id, second.id):
        preview = previews[entity_id]
        assert preview.conflict_count == 1
        assert preview.complete is False
        assert preview.currency_totals == []
        assert preview.lines[0].membership_conflict is True
        assert preview.lines[0].included_in_total is False
        assert "billing_entity_membership_conflict" in preview.lines[0].issues


def test_allocated_quota_analysis_keeps_measured_storage_and_exposes_blocked_quota(db_session):
    endpoint = _endpoint(db_session, "analysis-quota")
    account = _account(db_session, endpoint, "reserved")
    plan = _rate_plan(
        db_session,
        name="quota-plan",
        currency="EUR",
        basis="allocated_quota",
        storage_price="1",
    )
    entity = _entity(db_session, name="Reserved", account_ids=[account.id], rate_plan_id=plan.id)
    _month_data(
        db_session,
        endpoint,
        account,
        measured_gib=1,
        quota_gib=2,
        unusable_quota_day=16,
    )

    result = BillingAnalysisService(db_session).preview("2026-01")
    preview = next(item for item in result.entities if item.billing_entity_id == entity.id)
    line = preview.lines[0]

    assert line.storage.avg_gb_month == Decimal("1.000000000000")
    assert line.cost is not None
    assert line.cost.storage_quantity is not None
    assert line.cost.storage_quantity.basis == "allocated_quota"
    assert line.cost.storage_quantity.quantity_gib_month == Decimal("1.935483870968")
    assert line.cost.storage_quantity.observations_collected == 30
    assert line.cost.storage_quantity.observations_expected == 31
    assert line.cost.storage_quantity.status == "blocked"
    assert "unlimited_quota" in line.issues
    assert preview.storage_charge_bases == ["allocated_quota"]
    assert preview.coverage.quota_observations_collected == 30
    assert preview.coverage.quota_observations_expected == 31
    assert preview.coverage.quota_coverage_ratio == Decimal("0.967742")
    assert preview.complete is False
    assert preview.currency_totals[0].complete is False


def test_group_analysis_keeps_currencies_separate_and_allows_overlap(db_session):
    endpoint = _endpoint(db_session, "analysis-currencies")
    eur_account = _account(db_session, endpoint, "eur")
    usd_account = _account(db_session, endpoint, "usd")
    eur_plan = _rate_plan(db_session, name="eur-plan", currency="EUR")
    usd_plan = _rate_plan(db_session, name="usd-plan", currency="USD")
    eur_entity = _entity(db_session, name="EUR Entity", account_ids=[eur_account.id], rate_plan_id=eur_plan.id)
    usd_entity = _entity(db_session, name="USD Entity", account_ids=[usd_account.id], rate_plan_id=usd_plan.id)
    mixed = _group(db_session, "Mixed", [eur_entity.id, usd_entity.id])
    overlap = _group(db_session, "Research", [eur_entity.id])
    _month_data(db_session, endpoint, eur_account)
    _month_data(db_session, endpoint, usd_account)

    result = BillingAnalysisService(db_session).preview("2026-01")
    groups = {item.billing_entity_group_id: item for item in result.groups}

    assert [(item.currency, item.total_cost) for item in groups[mixed.id].currency_totals] == [
        ("EUR", Decimal("1.000000")),
        ("USD", Decimal("1.000000")),
    ]
    assert groups[overlap.id].member_entity_ids == [eur_entity.id]
    assert groups[overlap.id].currency_totals[0].total_cost == Decimal("1.000000")
