from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.models.billing import (
    BillingEntityGroupMembershipInput,
    BillingEntityGroupPayload,
    BillingEntityGroupPreviewAmount,
    BillingEntityPayload,
)
from app.services.billing_entity_group_service import (
    BillingEntityGroupConflictError,
    BillingEntityGroupService,
)
from app.services.billing_entity_service import BillingEntityService


def _entity(db_session, name: str):
    return BillingEntityService(db_session).create(
        BillingEntityPayload(name=name, subject_type="account")
    )


def _membership(entity_id: int, start: date, end: date | None = None):
    return BillingEntityGroupMembershipInput(
        billing_entity_id=entity_id,
        effective_from=start,
        effective_to=end,
    )


def _payload(name: str, memberships=None):
    return BillingEntityGroupPayload(
        name=name,
        memberships=memberships or [],
    )


def test_entity_can_belong_to_multiple_groups_without_conflict(db_session):
    entity = _entity(db_session, "Research unit")
    service = BillingEntityGroupService(db_session)
    period = _membership(entity.id, date(2026, 1, 1))

    research = service.create(_payload("Research", [period]))
    dsi = service.create(_payload("DSI", [period]))

    assert service.member_entity_ids(research.id, month=date(2026, 5, 1)) == [entity.id]
    assert service.member_entity_ids(dsi.id, month=date(2026, 5, 1)) == [entity.id]


def test_same_entity_membership_periods_must_not_overlap(db_session):
    entity = _entity(db_session, "Shared unit")
    service = BillingEntityGroupService(db_session)

    with pytest.raises(BillingEntityGroupConflictError, match="must not overlap"):
        service.create(
            _payload(
                "Research",
                [
                    _membership(entity.id, date(2026, 1, 1), date(2026, 6, 30)),
                    _membership(entity.id, date(2026, 6, 1)),
                ],
            )
        )


def test_group_membership_is_resolved_by_requested_month_and_history_is_retained(db_session):
    first = _entity(db_session, "Research North")
    second = _entity(db_session, "Research South")
    service = BillingEntityGroupService(db_session)
    group = service.create(
        _payload(
            "Research",
            [
                _membership(first.id, date(2026, 1, 1), date(2026, 3, 31)),
                _membership(second.id, date(2026, 4, 1)),
            ],
        )
    )

    assert service.member_entity_ids(group.id, month=date(2026, 2, 1)) == [first.id]
    assert service.member_entity_ids(group.id, month=date(2026, 4, 1)) == [second.id]
    loaded = service.get(group.id)
    assert [(item.billing_entity_id, item.effective_from, item.effective_to) for item in loaded.memberships] == [
        (first.id, date(2026, 1, 1), date(2026, 3, 31)),
        (second.id, date(2026, 4, 1), None),
    ]


def test_group_preview_aggregation_keeps_currencies_separate_and_reports_missing_entities(db_session):
    first = _entity(db_session, "Entity EUR")
    second = _entity(db_session, "Entity USD")
    third = _entity(db_session, "Entity missing")
    service = BillingEntityGroupService(db_session)
    group = service.create(
        _payload(
            "Mixed group",
            [
                _membership(first.id, date(2026, 1, 1)),
                _membership(second.id, date(2026, 1, 1)),
                _membership(third.id, date(2026, 1, 1)),
            ],
        )
    )

    result = service.aggregate_preview(
        group.id,
        month="2026-06",
        entity_amounts=[
            BillingEntityGroupPreviewAmount(
                billing_entity_id=first.id,
                currency="eur",
                total_cost=Decimal("12.34"),
            ),
            BillingEntityGroupPreviewAmount(
                billing_entity_id=second.id,
                currency="USD",
                total_cost=Decimal("9.87"),
                complete=False,
            ),
            BillingEntityGroupPreviewAmount(
                billing_entity_id=999999,
                currency="EUR",
                total_cost=Decimal("1000"),
            ),
        ],
    )

    assert result.member_entity_ids == [first.id, second.id, third.id]
    assert result.missing_entity_ids == [third.id]
    assert result.complete is False
    assert [(item.currency, item.total_cost, item.billing_entity_ids, item.complete) for item in result.currency_totals] == [
        ("EUR", Decimal("12.34"), [first.id], False),
        ("USD", Decimal("9.87"), [second.id], False),
    ]


def test_deactivated_group_leaves_active_list_but_remains_historically_queryable(db_session):
    entity = _entity(db_session, "Historic unit")
    service = BillingEntityGroupService(db_session)
    group = service.create(
        _payload("Historic group", [_membership(entity.id, date(2026, 1, 1), date(2026, 2, 28))])
    )

    deactivated = service.deactivate(group.id)

    assert deactivated.active is False
    assert service.list(include_inactive=False) == []
    assert service.member_entity_ids(group.id, month=date(2026, 2, 1)) == [entity.id]


def test_group_update_preserves_unchanged_membership_row_identity(db_session):
    entity = _entity(db_session, "Stable membership")
    service = BillingEntityGroupService(db_session)
    membership = _membership(entity.id, date(2026, 1, 1))
    group = service.create(_payload("Research", [membership]))
    membership_id = group.memberships[0].id

    updated = service.update(
        group.id,
        BillingEntityGroupPayload(
            name="Research renamed",
            description="Updated metadata only",
            memberships=[membership],
        ),
    )

    assert updated.name == "Research renamed"
    assert updated.memberships[0].id == membership_id


def test_group_update_preserves_past_membership_history_but_allows_future_end(
    db_session,
    monkeypatch,
):
    monkeypatch.setattr(
        "app.services.billing_entity_group_service.utcnow",
        lambda: datetime(2026, 10, 19, tzinfo=timezone.utc),
    )
    historical_entity = _entity(db_session, "Historical unit")
    current_entity = _entity(db_session, "Current unit")
    service = BillingEntityGroupService(db_session)
    historical = _membership(
        historical_entity.id,
        date(2026, 1, 1),
        date(2026, 3, 31),
    )
    current = _membership(current_entity.id, date(2026, 4, 1))
    group = service.create(_payload("Stable history", [historical, current]))

    updated = service.update(
        group.id,
        _payload(
            "Stable history",
            [
                historical,
                _membership(current_entity.id, date(2026, 4, 1), date(2026, 12, 31)),
            ],
        ),
    )
    assert updated.memberships[1].effective_to == date(2026, 12, 31)

    with pytest.raises(BillingEntityGroupConflictError, match="history cannot be removed"):
        service.update(
            group.id,
            _payload(
                "Stable history",
                [_membership(current_entity.id, date(2026, 4, 1), date(2026, 12, 31))],
            ),
        )

    with pytest.raises(BillingEntityGroupConflictError, match="cannot be added retroactively"):
        service.update(
            group.id,
            _payload(
                "Stable history",
                [
                    historical,
                    _membership(current_entity.id, date(2026, 4, 1), date(2026, 12, 31)),
                    _membership(historical_entity.id, date(2026, 5, 1), date(2026, 5, 31)),
                ],
            ),
        )
