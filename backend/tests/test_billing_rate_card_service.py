from calendar import monthrange
from datetime import date, timedelta

import pytest

from app.db import BillingAssignment, StorageEndpoint
from app.models.billing import BillingRateCardPayload, BillingRateCardVersionCreate
from app.services.billing_rate_card_service import (
    BillingRateCardConflictError,
    BillingRateCardImmutableError,
    BillingRateCardService,
)
from app.utils.time import utcnow


def _endpoint(db_session) -> StorageEndpoint:
    row = StorageEndpoint(
        name="rates-endpoint",
        endpoint_url="https://rates.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(row)
    db_session.commit()
    return row


def _month_start(value: date) -> date:
    return value.replace(day=1)


def _next_month(value: date) -> date:
    return date(value.year + (1 if value.month == 12 else 0), 1 if value.month == 12 else value.month + 1, 1)


def _month_end(value: date) -> date:
    return value.replace(day=monthrange(value.year, value.month)[1])


def _previous_month(value: date) -> date:
    return (value.replace(day=1) - timedelta(days=1)).replace(day=1)


def _payload(
    name: str,
    start: date,
    endpoint_id: int | None = None,
    end: date | None = None,
    storage_charge_basis: str = "actual_usage",
):
    return BillingRateCardPayload(
        name=name,
        currency="eur",
        storage_charge_basis=storage_charge_basis,
        storage_gb_month_price=0.02,
        egress_gb_price=0.08,
        ingress_gb_price=0,
        requests_per_1000_price=0.004,
        effective_from=start,
        effective_to=end,
        storage_endpoint_id=endpoint_id,
    )


def test_rate_cards_support_global_and_endpoint_scopes_and_reject_overlap(db_session):
    endpoint = _endpoint(db_session)
    start = _next_month(utcnow().date())
    service = BillingRateCardService(db_session)

    global_item = service.create(_payload("default", start))
    endpoint_item = service.create(_payload("default", start, endpoint.id))

    assert global_item.storage_endpoint_id is None
    assert global_item.status == "future"
    assert global_item.editable is True
    assert global_item.storage_charge_basis == "actual_usage"
    assert endpoint_item.storage_endpoint_id == endpoint.id
    assert endpoint_item.storage_endpoint_name == endpoint.name

    with pytest.raises(BillingRateCardConflictError, match="name and scope"):
        service.create(_payload("default", start))


def test_active_rate_card_is_immutable_and_versioning_closes_current_month(db_session):
    endpoint = _endpoint(db_session)
    today = utcnow().date()
    current_start = _month_start(today)
    next_start = _next_month(today)
    service = BillingRateCardService(db_session)
    current = service.create(_payload("default", current_start, endpoint.id))

    with pytest.raises(BillingRateCardImmutableError):
        service.update(current.id, _payload("default", current_start, endpoint.id))

    version = service.create_version(
        current.id,
        BillingRateCardVersionCreate(
            currency="EUR",
            storage_charge_basis="allocated_quota",
            storage_gb_month_price=0.03,
            egress_gb_price=0.09,
            ingress_gb_price=0,
            requests_per_1000_price=0.005,
            effective_from=next_start,
        ),
    )

    expired_current = service.get(current.id)
    assert expired_current.effective_to == _month_end(today)
    assert version.effective_from == next_start
    assert version.status == "future"
    assert version.storage_endpoint_id == endpoint.id
    assert version.rate_plan_id == current.rate_plan_id
    assert version.storage_charge_basis == "allocated_quota"
    assert version.identity_editable is False


def test_future_rate_card_can_be_updated_and_deleted(db_session):
    start = _next_month(utcnow().date())
    later = _next_month(start)
    service = BillingRateCardService(db_session)
    created = service.create(_payload("future", start))

    updated = service.update(created.id, _payload("future", later))
    assert updated.effective_from == later
    assert updated.currency == "EUR"

    service.delete(updated.id)
    with pytest.raises(ValueError, match="not found"):
        service.get(updated.id)


def test_expired_rate_card_cannot_be_updated_or_deleted(db_session):
    previous = _previous_month(utcnow().date())
    service = BillingRateCardService(db_session)
    expired = service.create(
        _payload("expired", previous, end=_month_end(previous))
    )

    assert expired.status == "expired"
    with pytest.raises(BillingRateCardImmutableError, match="future"):
        service.update(
            expired.id,
            _payload("expired", previous, end=_month_end(previous)),
        )
    with pytest.raises(BillingRateCardImmutableError, match="future"):
        service.delete(expired.id)


def test_future_rate_card_update_rejects_overlap_with_existing_version(db_session):
    today = utcnow().date()
    service = BillingRateCardService(db_session)
    current = service.create(_payload("overlap-plan", _month_start(today)))
    future = service.create_version(
        current.id,
        BillingRateCardVersionCreate(
            currency="EUR",
            storage_charge_basis="actual_usage",
            storage_gb_month_price=0.03,
            egress_gb_price=0.09,
            ingress_gb_price=0,
            requests_per_1000_price=0.005,
            effective_from=_next_month(today),
        ),
    )

    with pytest.raises(BillingRateCardConflictError, match="overlap"):
        service.update(
            future.id,
            _payload("overlap-plan", _month_start(today)),
        )


def test_rate_card_rejects_unknown_endpoint(db_session):
    service = BillingRateCardService(db_session)

    with pytest.raises(ValueError, match="Endpoint not found"):
        service.create(
            _payload("missing-endpoint", _next_month(utcnow().date()), 999999)
        )


def test_future_version_cannot_change_rate_plan_identity_after_history_exists(db_session):
    endpoint = _endpoint(db_session)
    today = utcnow().date()
    service = BillingRateCardService(db_session)
    current = service.create(_payload("stable-plan", _month_start(today), endpoint.id))
    future = service.create_version(
        current.id,
        BillingRateCardVersionCreate(
            currency="EUR",
            storage_charge_basis="actual_usage",
            storage_gb_month_price=0.03,
            egress_gb_price=0.09,
            ingress_gb_price=0,
            requests_per_1000_price=0.005,
            effective_from=_next_month(today),
        ),
    )

    with pytest.raises(BillingRateCardImmutableError, match="identity"):
        service.update(
            future.id,
            _payload("renamed-plan", future.effective_from, endpoint.id),
        )


def test_assigned_only_future_version_cannot_be_deleted(db_session):
    endpoint = _endpoint(db_session)
    start = _next_month(utcnow().date())
    service = BillingRateCardService(db_session)
    item = service.create(_payload("assigned-plan", start, endpoint.id))
    db_session.add(
        BillingAssignment(
            storage_endpoint_id=endpoint.id,
            s3_account_id=None,
            s3_user_id=None,
            rate_plan_id=item.rate_plan_id,
            effective_from=start,
        )
    )
    # BillingAssignment normally targets one subject; this service-level test
    # only needs a persisted plan reference to exercise the delete safeguard.
    db_session.flush()

    with pytest.raises(BillingRateCardConflictError, match="assigned"):
        service.delete(item.id)


def test_deleting_future_replacement_reopens_previous_version(db_session):
    today = utcnow().date()
    service = BillingRateCardService(db_session)
    current = service.create(_payload("reopen-plan", _month_start(today)))
    future = service.create_version(
        current.id,
        BillingRateCardVersionCreate(
            currency="EUR",
            storage_charge_basis="actual_usage",
            storage_gb_month_price=0.03,
            egress_gb_price=0.09,
            ingress_gb_price=0,
            requests_per_1000_price=0.005,
            effective_from=_next_month(today),
        ),
    )

    service.delete(future.id)

    reopened = service.get(current.id)
    assert reopened.effective_to is None
    assert reopened.status == "active"
