# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from datetime import date

import pytest

from app.db import (
    BillingAssignment,
    BillingEntity,
    BillingEntityRateAssignment,
    BillingEntitySubjectRule,
    BillingRateCard,
    BillingRatePlan,
    S3Account,
    StorageEndpoint,
)
from app.services.billing_rate_resolution_service import (
    BillingRateCurrencyConflictError,
    BillingRateResolutionService,
)


def _endpoint(db_session, name: str) -> StorageEndpoint:
    row = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(row)
    db_session.flush()
    return row


def _account(db_session, endpoint: StorageEndpoint, name: str) -> S3Account:
    row = S3Account(
        name=name,
        rgw_account_id=f"RGW{name.upper():0<17}"[:20],
        rgw_user_uid=f"{name}-admin",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(row)
    db_session.flush()
    return row


def _plan(
    db_session,
    *,
    name: str,
    endpoint_id: int | None,
    price: int,
    currency: str = "EUR",
    basis: str = "actual_usage",
    effective_from: date = date(2026, 1, 1),
    effective_to: date | None = None,
) -> tuple[BillingRatePlan, BillingRateCard]:
    plan = BillingRatePlan(name=name, storage_endpoint_id=endpoint_id)
    card = BillingRateCard(
        rate_plan=plan,
        currency=currency,
        storage_charge_basis=basis,
        storage_gb_month_price=price,
        effective_from=effective_from,
        effective_to=effective_to,
    )
    db_session.add(card)
    db_session.flush()
    return plan, card


def _entity_for_accounts(
    db_session,
    *,
    name: str,
    account_ids: list[int],
    rate_plan_id: int | None = None,
) -> BillingEntity:
    entity = BillingEntity(name=name, subject_type="account", active=True)
    db_session.add(entity)
    db_session.flush()
    entity.subject_rules = [
        BillingEntitySubjectRule(rule_type="include", s3_account_id=account_id)
        for account_id in account_ids
    ]
    if rate_plan_id is not None:
        entity.rate_assignments = [
            BillingEntityRateAssignment(
                rate_plan_id=rate_plan_id,
                effective_from=date(2026, 1, 1),
            )
        ]
    db_session.flush()
    return entity


def test_rate_resolution_enforces_direct_entity_endpoint_global_precedence(db_session):
    endpoint = _endpoint(db_session, "primary")
    account = _account(db_session, endpoint, "acme")
    direct_plan, direct_card = _plan(
        db_session,
        name="direct-acme",
        endpoint_id=endpoint.id,
        price=1,
        basis="allocated_quota",
    )
    entity_plan, entity_card = _plan(
        db_session,
        name="research",
        endpoint_id=None,
        price=2,
    )
    _, endpoint_card = _plan(
        db_session,
        name="default",
        endpoint_id=endpoint.id,
        price=3,
    )
    _, global_card = _plan(
        db_session,
        name="default",
        endpoint_id=None,
        price=4,
    )
    entity = _entity_for_accounts(
        db_session,
        name="Research",
        account_ids=[account.id],
        rate_plan_id=entity_plan.id,
    )
    direct_assignment = BillingAssignment(
        storage_endpoint_id=endpoint.id,
        s3_account_id=account.id,
        rate_plan_id=direct_plan.id,
        effective_from=date(2026, 1, 1),
    )
    db_session.add(direct_assignment)
    db_session.commit()

    resolver = BillingRateResolutionService(db_session)
    direct = resolver.resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )
    assert direct.rate_card is not None and direct.rate_card.id == direct_card.id
    assert direct.explanation.layer == "direct"
    assert direct.explanation.source_assignment_id == direct_assignment.id
    assert direct.explanation.storage_charge_basis == "allocated_quota"

    db_session.delete(direct_assignment)
    db_session.commit()
    entity_rate = resolver.resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )
    assert entity_rate.rate_card is not None and entity_rate.rate_card.id == entity_card.id
    assert entity_rate.explanation.layer == "billing_entity"
    assert entity_rate.explanation.billing_entity_id == entity.id
    assert entity_rate.explanation.billing_entity_name == "Research"

    db_session.delete(entity.rate_assignments[0])
    db_session.commit()
    endpoint_rate = resolver.resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )
    assert endpoint_rate.rate_card is not None and endpoint_rate.rate_card.id == endpoint_card.id
    assert endpoint_rate.explanation.layer == "endpoint"

    endpoint_card.effective_to = date(2025, 12, 31)
    db_session.commit()
    global_rate = resolver.resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )
    assert global_rate.rate_card is not None and global_rate.rate_card.id == global_card.id
    assert global_rate.explanation.layer == "global"


def test_assigned_plan_without_effective_version_is_explicitly_missing(db_session):
    endpoint = _endpoint(db_session, "missing-version")
    account = _account(db_session, endpoint, "missing")
    direct_plan, _ = _plan(
        db_session,
        name="future-direct",
        endpoint_id=endpoint.id,
        price=1,
        effective_from=date(2026, 2, 1),
    )
    _, endpoint_card = _plan(
        db_session,
        name="default",
        endpoint_id=endpoint.id,
        price=3,
    )
    assignment = BillingAssignment(
        storage_endpoint_id=endpoint.id,
        s3_account_id=account.id,
        rate_plan_id=direct_plan.id,
        effective_from=date(2026, 1, 1),
    )
    db_session.add(assignment)
    db_session.commit()

    result = BillingRateResolutionService(db_session).resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )

    assert result.rate_card is None
    assert result.explanation.status == "missing"
    assert result.explanation.layer == "direct"
    assert result.explanation.rate_plan_id == direct_plan.id
    assert result.explanation.source_assignment_id == assignment.id
    assert result.explanation.issues == ["assigned_rate_plan_has_no_effective_version"]
    assert result.explanation.rate_card_id != endpoint_card.id


def test_entity_membership_conflict_is_explicit_and_direct_assignment_still_wins(db_session):
    endpoint = _endpoint(db_session, "conflict")
    account = _account(db_session, endpoint, "conflict")
    _entity_for_accounts(db_session, name="Research", account_ids=[account.id])
    _entity_for_accounts(db_session, name="DSI", account_ids=[account.id])
    direct_plan, direct_card = _plan(
        db_session,
        name="direct-conflict",
        endpoint_id=endpoint.id,
        price=1,
    )
    db_session.commit()

    unresolved = BillingRateResolutionService(db_session).resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )
    assert unresolved.rate_card is None
    assert unresolved.explanation.status == "conflict"
    assert unresolved.explanation.layer == "billing_entity"
    assert unresolved.explanation.issues == ["billing_entity_membership_conflict"]
    assert set(unresolved.explanation.conflicting_billing_entity_names) == {"Research", "DSI"}

    db_session.add(
        BillingAssignment(
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            rate_plan_id=direct_plan.id,
            effective_from=date(2026, 1, 1),
        )
    )
    db_session.commit()
    resolved = BillingRateResolutionService(db_session).resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )
    assert resolved.rate_card is not None and resolved.rate_card.id == direct_card.id
    assert resolved.explanation.layer == "direct"


def test_entity_rate_plan_resolves_across_multiple_endpoints(db_session):
    endpoint_a = _endpoint(db_session, "entity-a")
    endpoint_b = _endpoint(db_session, "entity-b")
    account_a = _account(db_session, endpoint_a, "entity-a")
    account_b = _account(db_session, endpoint_b, "entity-b")
    entity_plan, entity_card = _plan(
        db_session,
        name="research-multi-endpoint",
        endpoint_id=None,
        price=2,
    )
    entity = _entity_for_accounts(
        db_session,
        name="Research multi-endpoint",
        account_ids=[account_a.id, account_b.id],
        rate_plan_id=entity_plan.id,
    )
    db_session.commit()

    resolver = BillingRateResolutionService(db_session)
    for endpoint, account in ((endpoint_a, account_a), (endpoint_b, account_b)):
        result = resolver.resolve(
            endpoint_id=endpoint.id,
            period_start=date(2026, 1, 1),
            subject_type="account",
            subject_id=account.id,
        )
        assert result.rate_card is not None and result.rate_card.id == entity_card.id
        assert result.explanation.layer == "billing_entity"
        assert result.explanation.billing_entity_id == entity.id


def test_effective_rate_version_controls_prices_basis_and_currency(db_session):
    endpoint = _endpoint(db_session, "versions")
    account = _account(db_session, endpoint, "versions")
    plan = BillingRatePlan(name="versioned-direct", storage_endpoint_id=endpoint.id)
    january = BillingRateCard(
        rate_plan=plan,
        currency="EUR",
        storage_charge_basis="actual_usage",
        storage_gb_month_price=1,
        effective_from=date(2026, 1, 1),
        effective_to=date(2026, 1, 31),
    )
    february = BillingRateCard(
        rate_plan=plan,
        currency="USD",
        storage_charge_basis="allocated_quota",
        storage_gb_month_price=2,
        effective_from=date(2026, 2, 1),
    )
    db_session.add_all([january, february])
    db_session.flush()
    db_session.add(
        BillingAssignment(
            storage_endpoint_id=endpoint.id,
            s3_account_id=account.id,
            rate_plan_id=plan.id,
            effective_from=date(2026, 1, 1),
        )
    )
    db_session.commit()

    resolver = BillingRateResolutionService(db_session)
    jan = resolver.resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
        subject_type="account",
        subject_id=account.id,
    )
    feb = resolver.resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 2, 1),
        subject_type="account",
        subject_id=account.id,
    )

    assert jan.rate_card is not None and jan.rate_card.id == january.id
    assert jan.explanation.rate_card_id == january.id
    assert jan.explanation.storage_charge_basis == "actual_usage"
    assert jan.explanation.currency == "EUR"
    assert feb.rate_card is not None and feb.rate_card.id == february.id
    assert feb.explanation.rate_card_id == february.id
    assert feb.explanation.storage_charge_basis == "allocated_quota"
    assert feb.explanation.currency == "USD"


def test_currency_compatibility_must_be_checked_before_combining_rates(db_session):
    endpoint_eur = _endpoint(db_session, "currency-eur")
    endpoint_usd = _endpoint(db_session, "currency-usd")
    _plan(db_session, name="default", endpoint_id=endpoint_eur.id, price=1, currency="EUR")
    _plan(db_session, name="default", endpoint_id=endpoint_usd.id, price=1, currency="USD")
    db_session.commit()

    resolver = BillingRateResolutionService(db_session)
    eur = resolver.resolve(endpoint_id=endpoint_eur.id, period_start=date(2026, 1, 1))
    usd = resolver.resolve(endpoint_id=endpoint_usd.id, period_start=date(2026, 1, 1))

    assert resolver.require_compatible_currency([eur]) == "EUR"
    with pytest.raises(BillingRateCurrencyConflictError, match="different currencies"):
        resolver.require_compatible_currency([eur, usd])


def test_non_default_endpoint_plans_are_not_implicit_fallbacks(db_session):
    endpoint = _endpoint(db_session, "ambiguous")
    _plan(db_session, name="standard", endpoint_id=endpoint.id, price=1)
    _plan(db_session, name="premium", endpoint_id=endpoint.id, price=2)
    db_session.commit()

    result = BillingRateResolutionService(db_session).resolve(
        endpoint_id=endpoint.id,
        period_start=date(2026, 1, 1),
    )

    assert result.rate_card is None
    assert result.explanation.status == "missing"
    assert result.explanation.layer is None
    assert result.explanation.issues == ["no_effective_rate_plan"]
