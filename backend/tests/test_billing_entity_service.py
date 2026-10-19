from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from app.db import BillingEntityTagRule, BillingRatePlan, S3Account, S3User, StorageEndpoint, TagDefinition
from app.models.billing import BillingEntityPayload, BillingEntityRateAssignmentInput
from app.services.billing_entity_service import BillingEntityConflictError, BillingEntityService
from app.services.tags_service import TagsService
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED, TAG_DOMAIN_ENDPOINT
from app.utils.time import utcnow


def _endpoint(db_session, *, name: str = "billing-entity-endpoint") -> StorageEndpoint:
    endpoint = StorageEndpoint(
        name=name,
        endpoint_url=f"https://{name}.example.test",
        provider="ceph",
        is_default=False,
    )
    db_session.add(endpoint)
    db_session.commit()
    return endpoint


def _account(db_session, endpoint: StorageEndpoint, *, name: str, rgw_id: str) -> S3Account:
    account = S3Account(
        name=name,
        rgw_account_id=rgw_id,
        rgw_user_uid=f"{rgw_id}-root",
        rgw_tenant="",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(account)
    db_session.commit()
    return account


def _s3_user(db_session, endpoint: StorageEndpoint, *, name: str, uid: str, tenant: str = "") -> S3User:
    user = S3User(
        name=name,
        rgw_user_uid=uid,
        rgw_tenant=tenant,
        rgw_access_key=f"AK-{uid}",
        rgw_secret_key="secret",
        storage_endpoint_id=endpoint.id,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _payload(
    *,
    name: str,
    subject_type: str = "account",
    tags: list[int] | None = None,
    includes: list[int] | None = None,
    excludes: list[int] | None = None,
    assignments: list[BillingEntityRateAssignmentInput] | None = None,
) -> BillingEntityPayload:
    return BillingEntityPayload(
        name=name,
        subject_type=subject_type,
        include_tag_ids=tags or [],
        explicit_include_ids=includes or [],
        explicit_exclude_ids=excludes or [],
        rate_assignments=assignments or [],
    )


def test_hybrid_membership_applies_tags_includes_and_excludes_deterministically(db_session):
    endpoint = _endpoint(db_session)
    tagged_a = _account(db_session, endpoint, name="Research A", rgw_id="RGW-A")
    tagged_b = _account(db_session, endpoint, name="Research B", rgw_id="RGW-B")
    explicit = _account(db_session, endpoint, name="Explicit", rgw_id="RGW-C")
    tags = TagsService(db_session)
    tag = tags.replace_account_tags(
        tagged_a,
        [{"label": "research", "color_key": "sky", "scope": "administrative"}],
    )[0]
    tags.replace_account_tags(
        tagged_b,
        [{"label": "research", "color_key": "sky", "scope": "administrative"}],
    )
    db_session.commit()

    service = BillingEntityService(db_session)
    created = service.create(
        _payload(
            name="Research",
            tags=[tag.id],
            includes=[explicit.id],
            excludes=[tagged_b.id],
        )
    )

    assert created.member_count == 2
    resolution = service.resolve_all()
    entity = resolution.entities[0]
    assert [subject.name for subject in entity.members] == ["Explicit", "Research A"]
    assert [subject.name for subject in entity.excluded] == ["Research B"]
    assert [reason.kind for reason in entity.excluded[0].reasons] == ["tag", "explicit_exclude"]
    assert {subject.subject_id for subject in resolution.unassigned if subject.subject_type == "account"} == {
        tagged_b.id
    }
    research = next(subject for subject in entity.members if subject.subject_id == tagged_a.id)
    assert [(reason.kind, reason.label) for reason in research.reasons] == [("tag", "research")]
    added = next(subject for subject in entity.members if subject.subject_id == explicit.id)
    assert [reason.kind for reason in added.reasons] == ["explicit_include"]


def test_cross_entity_conflicts_are_first_class_and_deactivation_removes_them(db_session):
    endpoint = _endpoint(db_session)
    account = _account(db_session, endpoint, name="Shared account", rgw_id="RGW-SHARED")
    service = BillingEntityService(db_session)
    first = service.create(_payload(name="Entity A", includes=[account.id]))
    second = service.create(_payload(name="Entity B", includes=[account.id]))

    resolution = service.resolve_all()
    assert len(resolution.conflicts) == 1
    assert resolution.conflicts[0].subject.subject_id == account.id
    assert [entry.entity_name for entry in resolution.conflicts[0].entities] == ["Entity A", "Entity B"]
    assert service.get(first.id).conflict_count == 1
    assert service.get(second.id).conflict_count == 1

    service.deactivate(second.id)
    assert service.get(second.id).active is False
    assert service.resolve_all().conflicts == []
    assert service.get(first.id).conflict_count == 0


def test_membership_never_mixes_account_and_s3_user_subject_levels(db_session):
    endpoint = _endpoint(db_session)
    account = _account(db_session, endpoint, name="Account tagged", rgw_id="RGW-ACCOUNT")
    user = _s3_user(db_session, endpoint, name="User tagged", uid="user-a", tenant="tenant-a")
    tags = TagsService(db_session)
    tag = tags.replace_account_tags(
        account,
        [{"label": "unit-a", "color_key": "emerald", "scope": "standard"}],
    )[0]
    tags.replace_s3_user_tags(
        user,
        [{"label": "unit-a", "color_key": "emerald", "scope": "standard"}],
    )
    db_session.commit()

    service = BillingEntityService(db_session)
    account_entity = service.create(_payload(name="Accounts", tags=[tag.id]))
    user_entity = service.create(_payload(name="Users", subject_type="s3_user", tags=[tag.id]))
    resolution = service.resolve_all()

    account_resolution = next(item for item in resolution.entities if item.entity_id == account_entity.id)
    user_resolution = next(item for item in resolution.entities if item.entity_id == user_entity.id)
    assert [item.subject_id for item in account_resolution.members] == [account.id]
    assert [item.subject_id for item in user_resolution.members] == [user.id]
    assert user_resolution.members[0].rgw_identifier == "tenant-a$user-a"
    assert resolution.conflicts == []


def test_entity_validates_admin_tags_subjects_and_global_rate_plan_periods(db_session):
    endpoint = _endpoint(db_session)
    account = _account(db_session, endpoint, name="Account", rgw_id="RGW-ACCOUNT")
    endpoint_tag = TagDefinition(
        domain_kind=TAG_DOMAIN_ENDPOINT,
        owner_user_id=None,
        label="endpoint-only",
        label_key="endpoint-only",
        color_key="neutral",
        scope="standard",
    )
    global_plan = BillingRatePlan(name="global-plan", storage_endpoint_id=None)
    endpoint_plan = BillingRatePlan(name="endpoint-plan", storage_endpoint_id=endpoint.id)
    db_session.add_all([endpoint_tag, global_plan, endpoint_plan])
    db_session.commit()
    current_month = utcnow().date().replace(day=1)

    service = BillingEntityService(db_session)
    with pytest.raises(ValueError, match="Admin-managed"):
        service.create(_payload(name="Invalid tag", tags=[endpoint_tag.id]))
    with pytest.raises(ValueError, match="Unknown account"):
        service.create(_payload(name="Invalid subject", includes=[999999]))
    with pytest.raises(ValueError, match="global Rate Plan"):
        service.create(
            _payload(
                name="Endpoint plan",
                includes=[account.id],
                assignments=[
                    BillingEntityRateAssignmentInput(
                        rate_plan_id=endpoint_plan.id,
                        effective_from=current_month,
                    )
                ],
            )
        )
    with pytest.raises(BillingEntityConflictError, match="overlap"):
        service.create(
            _payload(
                name="Overlap",
                assignments=[
                    BillingEntityRateAssignmentInput(
                        rate_plan_id=global_plan.id,
                        effective_from=current_month,
                    ),
                    BillingEntityRateAssignmentInput(
                        rate_plan_id=global_plan.id,
                        effective_from=date(
                            current_month.year + (1 if current_month.month == 12 else 0),
                            1 if current_month.month == 12 else current_month.month + 1,
                            1,
                        ),
                    ),
                ],
            )
        )


def test_entity_update_preserves_rate_assignments_after_they_become_historical(db_session, monkeypatch):
    global_plan = BillingRatePlan(name="historical-plan", storage_endpoint_id=None)
    db_session.add(global_plan)
    db_session.commit()
    current_month = utcnow().date().replace(day=1)
    service = BillingEntityService(db_session)
    created = service.create(
        _payload(
            name="Historical entity",
            assignments=[
                BillingEntityRateAssignmentInput(
                    rate_plan_id=global_plan.id,
                    effective_from=current_month,
                )
            ],
        )
    )
    assignment_id = created.rate_assignments[0].id
    next_month = date(
        current_month.year + (1 if current_month.month == 12 else 0),
        1 if current_month.month == 12 else current_month.month + 1,
        1,
    )
    monkeypatch.setattr(
        "app.services.billing_entity_service.utcnow",
        lambda: datetime(next_month.year, next_month.month, 15, tzinfo=timezone.utc),
    )

    updated = service.update(
        created.id,
        _payload(
            name="Historical entity renamed",
            assignments=[
                BillingEntityRateAssignmentInput(
                    rate_plan_id=global_plan.id,
                    effective_from=current_month,
                )
            ],
        ),
    )

    assert updated.name == "Historical entity renamed"
    assert updated.rate_assignments[0].id == assignment_id
    with pytest.raises(ValueError, match="Historical.*cannot be changed"):
        service.update(created.id, _payload(name="Drops history"))


def test_admin_tag_definition_referenced_by_billing_entity_is_not_cleaned_as_orphan(db_session):
    tag = TagDefinition(
        domain_kind=TAG_DOMAIN_ADMIN_MANAGED,
        owner_user_id=None,
        label="billing-only",
        label_key="billing-only",
        color_key="amber",
        scope="administrative",
    )
    db_session.add(tag)
    db_session.commit()
    entity = BillingEntityService(db_session).create(_payload(name="Billing only", tags=[tag.id]))
    assert db_session.query(BillingEntityTagRule).filter_by(billing_entity_id=entity.id).count() == 1

    TagsService(db_session).cleanup_orphan_definitions(domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED])
    db_session.commit()

    assert db_session.get(TagDefinition, tag.id) is not None
