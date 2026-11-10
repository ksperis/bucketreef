# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.db import (
    AccountIAMUser,
    AuditLog,
    PortalAdminRequest,
    S3Account,
    S3AccountDeletion,
    UiGroup,
    UiGroupS3Account,
    User,
    UserNotification,
    UserS3Account,
    UserUiGroup,
)
from app.core.domain_enums import ManagerAccountRole, PortalAccountRole, UserRole
from app.models.portal_requests import (
    PortalAdminRequestDecision,
    PortalAdminRequestListingRequest,
    PortalAccountQuotaChangeRequestCreate,
    PortalSettingChangeRequestCreate,
    PortalUserAccessRequestCreate,
    PortalUserRemovalRequestCreate,
)
from app.models.portal_usage import PortalUsage
from app.services.access_context_contracts import AccountAccess, AccountCapabilities

from app.services.portal_service import PortalService
from app.services.portal_requests_service import PortalRequestConflict, PortalRequestExecutionError, PortalRequestsService
from tests.db_transaction_test_utils import (
    fail_next_sqlite_statement_with_busy_snapshot,
    fail_next_transaction_commit,
)
from tests.s3_account_factory import make_s3_account


class FakeAccountQuotaOperations:
    def __init__(self, quota=(10.0, 123)) -> None:
        self.quota = quota
        self.updates = []

    def get_quota(self, account):  # noqa: ANN001
        return self.quota

    def update(self, account, max_size_gb, max_objects, max_size_unit=None):  # noqa: ANN001
        self.updates.append((account.id, max_size_gb, max_objects, max_size_unit))


class FakeAccountRepository:
    def __init__(self) -> None:
        self.checked_account_ids = []

    def ensure_not_pending_deletion(self, account_id):  # noqa: ANN001
        self.checked_account_ids.append(account_id)


def test_portal_request_optional_text_is_normalized() -> None:
    payload = PortalAdminRequestDecision(message="  project\n  code  ")

    assert payload.message == "project code"
    assert PortalAdminRequestDecision(message="   ").message is None


def _seed_account(db_session, *, name="Research Account") -> S3Account:
    account = make_s3_account(db_session, name=name, rgw_account_id="RGW00000000000000042")
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)
    return account


def _seed_user(
    db_session,
    *,
    email: str,
    role: str = UserRole.UI_USER.value,
    active: bool = True,
    full_name: str | None = None,
) -> User:
    user = User(
        email=email,
        full_name=full_name,
        hashed_password="x" if role != UserRole.UI_NONE.value else None,
        is_active=active,
        role=role,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _stored_request_result(db_session, request_id: int) -> dict:
    row = db_session.get(PortalAdminRequest, request_id)
    assert row is not None
    assert row.result is not None
    return row.result


def _portal_access(
    account: S3Account,
    user: User,
    *,
    portal_role: str = PortalAccountRole.PORTAL_USER.value,
) -> AccountAccess:
    return AccountAccess(
        account=account,
        actor=user,
        membership=None,
        portal_role=portal_role,
        capabilities=AccountCapabilities(),
    )


def _create_user_request(
    service: PortalRequestsService,
    account: S3Account,
    requester: User,
    *,
    portal_role: str = PortalAccountRole.PORTAL_USER.value,
):
    return service.create_request(
        requester,
        _portal_access(account, requester),
        PortalUserAccessRequestCreate(
            request_type="portal_user_access",
            intent="add",
            target_name="Jane Viewer",
            target_email="Jane.Viewer@Example.org",
            portal_role=portal_role,
        ),
    )


def test_portal_request_creation_lists_only_requester_and_notifies_admin(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    other = _seed_user(db_session, email="other@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)

    created = _create_user_request(service, account, requester)

    requester_rows = service.list_for_portal_user(requester, _portal_access(account, requester))
    other_rows = service.list_for_portal_user(other, _portal_access(account, other))
    notification = db_session.scalars(
        select(UserNotification).where(UserNotification.user_id == admin.id)
    ).one()
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "create_portal_request")
    ).one()

    assert created.status == "pending"
    assert created.payload["portal_role"] == PortalAccountRole.PORTAL_USER.value
    assert requester_rows[0].id == created.id
    assert other_rows == []
    assert notification.notification_type == "portal_request"
    assert notification.subject_type is None
    assert audit.scope == "portal"
    assert audit.context_kind == "portal_account"
    assert audit.context_id == str(account.id)


def test_portal_request_creation_rolls_back_session_when_commit_fails(
    db_session,
):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    service = PortalRequestsService(db_session)

    with fail_next_transaction_commit(db_session):
        with pytest.raises(RuntimeError, match="commit failed"):
            _create_user_request(service, account, requester)

    assert db_session.scalars(select(PortalAdminRequest)).all() == []


def test_portal_request_creation_retries_sqlite_busy_snapshot(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "INSERT INTO portal_admin_requests",
    ) as matching:
        created = _create_user_request(service, account, requester)

    requests = db_session.scalars(select(PortalAdminRequest)).all()
    notifications = db_session.scalars(
        select(UserNotification).where(UserNotification.user_id == admin.id)
    ).all()
    assert len(matching) == 2
    assert [row.id for row in requests] == [created.id]
    assert len(notifications) == 1


def test_portal_request_notification_retries_sqlite_busy_snapshot(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "INSERT INTO user_notifications",
    ) as matching:
        created = _create_user_request(service, account, requester)

    notifications = db_session.scalars(
        select(UserNotification).where(UserNotification.user_id == admin.id)
    ).all()
    assert len(matching) == 2
    assert created.status == "pending"
    assert len(notifications) == 1


def test_admin_search_matches_structured_request_payload(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)

    response = service.list_for_admin(
        PortalAdminRequestListingRequest(search="jane.viewer@example.org")
    )

    assert [row.id for row in response.items] == [created.id]
    assert response.total == 1


def test_admin_request_listing_is_paginated_and_searches_account_name(db_session):
    account = _seed_account(db_session, name="Research Account")
    first_requester = _seed_user(db_session, email="first@example.org")
    second_requester = _seed_user(db_session, email="second@example.org")
    service = PortalRequestsService(db_session)
    first = _create_user_request(service, account, first_requester)
    second = _create_user_request(service, account, second_requester)

    first_page = service.list_for_admin(
        PortalAdminRequestListingRequest(page=1, page_size=1)
    )
    second_page = service.list_for_admin(
        PortalAdminRequestListingRequest(page=2, page_size=1)
    )
    account_search = service.list_for_admin(
        PortalAdminRequestListingRequest(search="Research Account")
    )

    assert first_page.total == 2
    assert first_page.page == 1
    assert first_page.page_size == 1
    assert first_page.has_next is True
    assert [row.id for row in first_page.items] == [second.id]
    assert second_page.total == 2
    assert second_page.has_next is False
    assert [row.id for row in second_page.items] == [first.id]
    assert {row.id for row in account_search.items} == {first.id, second.id}


def test_approve_user_access_creates_placeholder_and_portal_link(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)

    approved = service.approve_request(created.id, admin, message="Done")

    target = db_session.scalars(
        select(User).where(User.email == "jane.viewer@example.org")
    ).one()
    link = db_session.scalars(
        select(UserS3Account).where(
            UserS3Account.user_id == target.id,
            UserS3Account.account_id == account.id,
        )
    ).one()
    message = approved.messages[0]
    result = _stored_request_result(db_session, approved.id)

    assert approved.status == "approved"
    assert result["created_user"] is True
    assert target.hashed_password is None
    assert target.role == UserRole.UI_USER.value
    assert link.manager_role is None
    assert link.portal_role == PortalAccountRole.PORTAL_USER.value
    assert message.message == "Done"


@pytest.mark.parametrize("failure_occurrence", [1, 2])
def test_portal_request_approval_retries_db_checkpoint_without_replaying_execution(
    db_session,
    monkeypatch,
    failure_occurrence,
):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)
    execution_calls = 0

    def execute_once(_row):
        nonlocal execution_calls
        execution_calls += 1
        return {"executed": True}

    monkeypatch.setattr(service, "_execute_request", execute_once)

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "UPDATE portal_admin_requests SET",
        occurrence=failure_occurrence,
    ) as matching:
        approved = service.approve_request(created.id, admin, message="Done")

    stored = db_session.get(PortalAdminRequest, created.id)
    assert stored is not None
    assert execution_calls == 1
    assert len(matching) >= failure_occurrence + 1
    assert approved.status == "approved"
    assert stored.status == "approved"
    assert stored.result == {"executed": True}
    assert [item.message for item in stored.messages] == ["Done"]


def test_approve_user_access_rolls_back_placeholder_when_assignment_fails(
    db_session,
    monkeypatch,
):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)
    monkeypatch.setattr(
        service.collaborator_requests.associations,
        "assign_account",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("assignment failed")),
    )

    with pytest.raises(PortalRequestExecutionError, match="assignment failed"):
        service.approve_request(created.id, admin)

    assert db_session.scalar(
        select(User).where(User.email == "jane.viewer@example.org")
    ) is None


def test_approve_user_access_assigns_requested_portal_manager_role(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = _create_user_request(
        service,
        account,
        requester,
        portal_role=PortalAccountRole.PORTAL_MANAGER.value,
    )

    approved = service.approve_request(created.id, admin)
    result = _stored_request_result(db_session, approved.id)

    target = db_session.scalars(
        select(User).where(User.email == "jane.viewer@example.org")
    ).one()
    link = db_session.scalars(
        select(UserS3Account).where(
            UserS3Account.user_id == target.id,
            UserS3Account.account_id == account.id,
        )
    ).one()
    assert result["requested_portal_role"] == PortalAccountRole.PORTAL_MANAGER.value
    assert result["portal_role"] == PortalAccountRole.PORTAL_MANAGER.value
    assert link.portal_role == PortalAccountRole.PORTAL_MANAGER.value


def test_approve_user_access_does_not_downgrade_existing_portal_manager(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="jane.viewer@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)

    approved = service.approve_request(created.id, admin)
    result = _stored_request_result(db_session, approved.id)

    assert result["requested_portal_role"] == PortalAccountRole.PORTAL_USER.value
    assert result["portal_role"] == PortalAccountRole.PORTAL_MANAGER.value
    link = db_session.scalars(
        select(UserS3Account).where(
            UserS3Account.user_id == target.id,
            UserS3Account.account_id == account.id,
        )
    ).one()
    assert link.portal_role == PortalAccountRole.PORTAL_MANAGER.value


def test_approve_user_access_rejects_noncanonical_missing_intent(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)
    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    payload = dict(row.payload)
    payload.pop("portal_role")
    payload.pop("intent", None)
    row.payload = payload
    db_session.add(row)
    db_session.commit()

    with pytest.raises(PortalRequestExecutionError, match="Invalid Portal collaborator request intent"):
        service.approve_request(created.id, admin)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("intent", " add ", "Invalid Portal collaborator request intent"),
        ("portal_role", " portal_user ", "Invalid requested Portal role"),
        ("portal_role", 1, "Invalid requested Portal role"),
    ],
)
def test_approve_user_access_rejects_noncanonical_persisted_values(
    db_session,
    field,
    value,
    message,
):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)
    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    payload = dict(row.payload)
    payload[field] = value
    row.payload = payload
    db_session.add(row)
    db_session.commit()

    with pytest.raises(PortalRequestExecutionError, match=message):
        service.approve_request(created.id, admin)


def test_approve_user_access_preserves_existing_portal_manager_role(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="jane.viewer@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=None,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)

    approved = service.approve_request(created.id, admin)
    result = _stored_request_result(db_session, approved.id)

    link = db_session.scalars(
        select(UserS3Account).where(
            UserS3Account.user_id == target.id,
            UserS3Account.account_id == account.id,
        )
    ).one()
    assert approved.status == "approved"
    assert result["created_user"] is False
    assert link.manager_role == ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
    assert link.portal_role == PortalAccountRole.PORTAL_USER.value


def test_approve_user_removal_deletes_portal_user_link_only(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="jane.viewer@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalUserRemovalRequestCreate(
            request_type="portal_user_removal",
            target_name="Jane Viewer",
            target_email="Jane.Viewer@Example.org",
        ),
    )

    approved = service.approve_request(created.id, admin)
    result = _stored_request_result(db_session, approved.id)

    assert approved.status == "approved"
    assert result["target_email"] == "jane.viewer@example.org"
    assert db_session.get(User, target.id) is not None
    assert db_session.scalar(
        select(UserS3Account).where(
            UserS3Account.user_id == target.id,
            UserS3Account.account_id == account.id,
        )
    ) is None


def test_approve_user_removal_refuses_portal_manager_link(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="manager@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalUserRemovalRequestCreate(
            request_type="portal_user_removal",
            target_email="manager@example.org",
        ),
    )

    with pytest.raises(PortalRequestExecutionError):
        service.approve_request(created.id, admin)

    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    assert row.status == "failed"
    assert "Only Portal user links" in (row.error_message or "")
    assert db_session.scalars(
        select(UserS3Account).where(
            UserS3Account.user_id == target.id,
            UserS3Account.account_id == account.id,
        )
    ).one()


def test_role_change_request_promotes_direct_portal_user(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="member@example.org", full_name="Project Member")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)

    created = service.create_request(
        requester,
        _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value),
        PortalUserAccessRequestCreate(
            request_type="portal_user_access",
            intent="role_change",
            target_user_id=target.id,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
            reason="Needs project administration",
        ),
    )

    assert created.payload == {
        "intent": "role_change",
        "target_user_id": target.id,
        "target_name": "Project Member",
        "target_email": "member@example.org",
        "current_portal_role": PortalAccountRole.PORTAL_USER.value,
        "portal_role": PortalAccountRole.PORTAL_MANAGER.value,
        "reason": "Needs project administration",
    }

    approved = service.approve_request(created.id, admin)
    result = _stored_request_result(db_session, approved.id)

    link = db_session.scalars(
        select(UserS3Account).where(
            UserS3Account.user_id == target.id,
            UserS3Account.account_id == account.id,
        )
    ).one()
    assert approved.status == "approved"
    assert result == {
        "target_user_id": target.id,
        "target_email": "member@example.org",
        "previous_portal_role": PortalAccountRole.PORTAL_USER.value,
        "portal_role": PortalAccountRole.PORTAL_MANAGER.value,
    }
    assert link.portal_role == PortalAccountRole.PORTAL_MANAGER.value


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("target_user_id", "7", "Target user is required"),
        ("current_portal_role", " portal_user ", "Invalid current Portal role"),
        ("portal_role", " portal_manager ", "Invalid requested Portal role"),
    ],
)
def test_role_change_execution_rejects_noncanonical_persisted_values(
    db_session,
    field,
    value,
    message,
):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="member@example.org", full_name="Project Member")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)
    created = service.create_request(
        requester,
        _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value),
        PortalUserAccessRequestCreate(
            request_type="portal_user_access",
            intent="role_change",
            target_user_id=target.id,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        ),
    )
    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    payload = dict(row.payload)
    payload[field] = value
    row.payload = payload
    db_session.add(row)
    db_session.commit()

    with pytest.raises(PortalRequestExecutionError, match=message):
        service.approve_request(created.id, admin)


def test_role_change_request_rejects_unchanged_role(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    target = _seed_user(db_session, email="member@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)

    with pytest.raises(ValueError, match="unchanged"):
        service.create_request(
            requester,
            _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value),
            PortalUserAccessRequestCreate(
                request_type="portal_user_access",
                intent="role_change",
                target_user_id=target.id,
                portal_role=PortalAccountRole.PORTAL_USER.value,
            ),
        )


def test_role_change_request_fails_if_role_changed_before_approval(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="member@example.org")
    link = UserS3Account(
        user_id=target.id,
        account_id=account.id,
        manager_role=None,
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )
    db_session.add(link)
    db_session.commit()
    service = PortalRequestsService(db_session)
    created = service.create_request(
        requester,
        _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value),
        PortalUserAccessRequestCreate(
            request_type="portal_user_access",
            intent="role_change",
            target_user_id=target.id,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        ),
    )
    link.portal_role = PortalAccountRole.PORTAL_MANAGER.value
    db_session.add(link)
    db_session.commit()

    with pytest.raises(PortalRequestExecutionError, match="changed after this request"):
        service.approve_request(created.id, admin)

    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    assert row.status == "failed"


@pytest.mark.parametrize(
    ("addition_delegated", "role_delegated", "requested_role", "expected_status"),
    [
        (False, False, PortalAccountRole.PORTAL_USER.value, "pending"),
        (True, False, PortalAccountRole.PORTAL_USER.value, "approved"),
        (False, True, PortalAccountRole.PORTAL_USER.value, "pending"),
        (False, False, PortalAccountRole.PORTAL_MANAGER.value, "pending"),
        (True, False, PortalAccountRole.PORTAL_MANAGER.value, "pending"),
        (False, True, PortalAccountRole.PORTAL_MANAGER.value, "pending"),
        (True, True, PortalAccountRole.PORTAL_MANAGER.value, "approved"),
    ],
)
def test_collaborator_addition_delegation_combinations(
    db_session,
    addition_delegated,
    role_delegated,
    requested_role,
    expected_status,
):
    account = _seed_account(db_session)
    account.portal_collaborator_addition_delegated = addition_delegated
    account.portal_collaborator_role_management_delegated = role_delegated
    db_session.add(account)
    db_session.commit()
    requester = _seed_user(db_session, email="manager@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)

    created = _create_user_request(
        service,
        account,
        requester,
        portal_role=requested_role,
    )

    assert created.status == expected_status
    admin_notifications = db_session.scalars(
        select(UserNotification).where(UserNotification.user_id == admin.id)
    ).all()
    assert len(admin_notifications) == (0 if expected_status == "approved" else 1)
    if expected_status == "approved":
        target = db_session.scalars(
            select(User).where(User.email == "jane.viewer@example.org")
        ).one()
        link = db_session.scalars(
            select(UserS3Account).where(
                UserS3Account.user_id == target.id,
                UserS3Account.account_id == account.id,
            )
        ).one()
        assert link.portal_role == requested_role
        delegated_audit = db_session.scalars(
            select(AuditLog).where(
                AuditLog.action == "execute_delegated_portal_request"
            )
        ).one()
        assert delegated_audit.audit_metadata["execution"] == "delegated"


def test_delegated_execution_failure_is_sanitized_and_audited(db_session, monkeypatch):
    account = _seed_account(db_session)
    account.portal_collaborator_addition_delegated = True
    db_session.add(account)
    db_session.commit()
    requester = _seed_user(db_session, email="manager@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)

    def fail_execution(_row):
        raise RuntimeError("secret_key=top-secret endpoint=https://rgw.example.test/api")

    monkeypatch.setattr(service, "_execute_request", fail_execution)

    with pytest.raises(PortalRequestExecutionError) as error:
        _create_user_request(service, account, requester)

    expected_detail = "secret_key=<redacted> endpoint=<redacted-url>"
    assert str(error.value) == expected_detail
    failed = db_session.scalars(
        select(PortalAdminRequest).where(PortalAdminRequest.account_id == account.id)
    ).one()
    assert failed.status == "failed"
    assert failed.error_message == expected_detail

    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "execute_delegated_portal_request")
    ).one()
    assert audit.scope == "portal"
    assert audit.status == "failure"
    metadata = audit.audit_metadata
    assert metadata is not None
    assert metadata["execution"] == "delegated"
    assert metadata["error"] == expected_detail
    assert db_session.scalar(
        select(func.count())
        .select_from(UserNotification)
        .where(UserNotification.user_id == admin.id)
    ) == 0


@pytest.mark.parametrize(
    ("current_role", "requested_role"),
    [
        (PortalAccountRole.PORTAL_USER.value, PortalAccountRole.PORTAL_MANAGER.value),
        (PortalAccountRole.PORTAL_MANAGER.value, PortalAccountRole.PORTAL_USER.value),
    ],
)
def test_delegated_role_change_is_applied_immediately(
    db_session,
    monkeypatch,
    current_role,
    requested_role,
):
    account = _seed_account(db_session)
    account.portal_collaborator_role_management_delegated = True
    db_session.add(account)
    db_session.commit()
    requester = _seed_user(db_session, email="manager@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="member@example.org", full_name="Project Member")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=None,
            portal_role=current_role,
        )
    )
    db_session.add(
        AccountIAMUser(
            user_id=target.id,
            account_id=account.id,
            iam_user_id="iam-delegated-role-change",
            iam_username="portal-delegated-role-change",
            active_access_key="AK-DELEGATED-ROLE-CHANGE",
            active_secret_key="SK-DELEGATED-ROLE-CHANGE",
        )
    )
    db_session.commit()
    iam_projection_calls: list[tuple[int, int, str | None]] = []
    monkeypatch.setattr(
        PortalService,
        "sync_existing_portal_user_access",
        lambda _service, user, target_account, role: iam_projection_calls.append(
            (int(user.id), int(target_account.id), role)
        ),
    )
    service = PortalRequestsService(db_session)

    created = service.create_request(
        requester,
        _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value),
        PortalUserAccessRequestCreate(
            request_type="portal_user_access",
            intent="role_change",
            target_user_id=target.id,
            portal_role=requested_role,
        ),
    )
    result = _stored_request_result(db_session, created.id)

    assert created.status == "approved"
    assert result["previous_portal_role"] == current_role
    assert result["portal_role"] == requested_role
    assert (
        db_session.scalars(
            select(UserS3Account).where(
                UserS3Account.user_id == target.id,
                UserS3Account.account_id == account.id,
            )
        )
        .one()
        .portal_role
        == requested_role
    )
    assert db_session.scalar(
        select(func.count())
        .select_from(UserNotification)
        .where(UserNotification.user_id == admin.id)
    ) == 0
    assert iam_projection_calls == [(target.id, account.id, requested_role)]


def test_nondelegated_role_change_stays_pending_and_notifies_admin(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="manager@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    target = _seed_user(db_session, email="member@example.org")
    db_session.add(
        UserS3Account(
            user_id=target.id,
            account_id=account.id,
            manager_role=None,
            portal_role=PortalAccountRole.PORTAL_USER.value,
        )
    )
    db_session.commit()
    service = PortalRequestsService(db_session)

    created = service.create_request(
        requester,
        _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value),
        PortalUserAccessRequestCreate(
            request_type="portal_user_access",
            intent="role_change",
            target_user_id=target.id,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        ),
    )

    assert created.status == "pending"
    assert db_session.scalar(
        select(func.count())
        .select_from(UserNotification)
        .where(UserNotification.user_id == admin.id)
    ) == 1


def test_role_change_rejects_self_and_group_backed_membership(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="manager@example.org")
    target = _seed_user(db_session, email="member@example.org")
    group = UiGroup(name="Portal collaborators")
    db_session.add(group)
    db_session.commit()
    db_session.add_all(
        [
            UserS3Account(
                user_id=requester.id,
                account_id=account.id,
                manager_role=None,
                portal_role=PortalAccountRole.PORTAL_MANAGER.value,
            ),
            UserS3Account(
                user_id=target.id,
                account_id=account.id,
                manager_role=None,
                portal_role=PortalAccountRole.PORTAL_USER.value,
            ),
            UserUiGroup(user_id=target.id, group_id=group.id),
            UiGroupS3Account(
                group_id=group.id,
                account_id=account.id,
                manager_role=None,
                portal_role=PortalAccountRole.PORTAL_USER.value,
            ),
        ]
    )
    db_session.commit()
    service = PortalRequestsService(db_session)
    access = _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value)

    with pytest.raises(ValueError, match="own project role"):
        service.create_request(
            requester,
            access,
            PortalUserAccessRequestCreate(
                request_type="portal_user_access",
                intent="role_change",
                target_user_id=requester.id,
                portal_role=PortalAccountRole.PORTAL_USER.value,
            ),
        )

    with pytest.raises(ValueError, match="direct-only"):
        service.create_request(
            requester,
            access,
            PortalUserAccessRequestCreate(
                request_type="portal_user_access",
                intent="role_change",
                target_user_id=target.id,
                portal_role=PortalAccountRole.PORTAL_MANAGER.value,
            ),
        )


def test_approve_user_access_marks_failed_for_inactive_existing_user(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    _seed_user(db_session, email="jane.viewer@example.org", active=False)
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)

    with pytest.raises(PortalRequestExecutionError):
        service.approve_request(created.id, admin)

    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    assert row.status == "failed"
    assert "inactive" in (row.error_message or "")
    assert db_session.scalar(
        select(func.count())
        .select_from(UserNotification)
        .where(UserNotification.user_id == requester.id)
    ) == 1
    audit = db_session.scalars(
        select(AuditLog).where(AuditLog.action == "approve_portal_request")
    ).one()
    assert audit.status == "failure"


def test_approve_quota_change_applies_new_account_quota_and_keeps_object_quota(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    fake_quota = FakeAccountQuotaOperations(quota=(10.0, 123))
    fake_repository = FakeAccountRepository()
    service = PortalRequestsService(
        db_session,
        account_metrics=fake_quota,
        account_quota=fake_quota,
        account_repository=fake_repository,
    )
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalAccountQuotaChangeRequestCreate(
            request_type="account_quota_change",
            direction="increase",
            target_quota_value=12,
            target_quota_unit="GiB",
        ),
    )

    approved = service.approve_request(created.id, admin)
    result = _stored_request_result(db_session, approved.id)

    assert approved.status == "approved"
    assert fake_repository.checked_account_ids == [account.id]
    assert fake_quota.updates == [(account.id, 12, 123, "GiB")]


def test_setting_change_request_rejects_when_project_settings_are_delegated(db_session):
    account = _seed_account(db_session)
    account.portal_settings_delegated = True
    db_session.add(account)
    db_session.commit()
    requester = _seed_user(db_session, email="manager@example.org")
    service = PortalRequestsService(db_session)

    with pytest.raises(ValueError, match="already delegated"):
        service.create_request(
            requester,
            _portal_access(
                account,
                requester,
                portal_role=PortalAccountRole.PORTAL_MANAGER.value,
            ),
            PortalSettingChangeRequestCreate(
                request_type="portal_setting_change",
                setting="browser_access_enabled",
                mode="override",
                value=True,
            ),
        )

    assert db_session.scalar(select(func.count()).select_from(PortalAdminRequest)) == 0


def test_setting_change_request_requires_portal_manager_before_persisting(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    service = PortalRequestsService(db_session)

    with pytest.raises(ValueError, match="Portal manager rights required"):
        service.create_request(
            requester,
            _portal_access(account, requester),
            PortalSettingChangeRequestCreate(
                request_type="portal_setting_change",
                setting="browser_access_enabled",
                mode="override",
                value=True,
            ),
        )

    assert db_session.scalar(select(func.count()).select_from(PortalAdminRequest)) == 0


def test_approve_setting_change_preserves_concurrent_project_overrides(db_session, monkeypatch):
    from app.models.app_settings import AppSettings
    monkeypatch.setattr("app.services.portal.settings.load_app_settings_for_db", lambda _db: AppSettings())
    account = _seed_account(db_session)
    account.portal_settings_override = {"allow_portal_named_bucket_create": True}
    db_session.add(account)
    db_session.commit()
    requester = _seed_user(db_session, email="manager@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = service.create_request(
        requester,
        _portal_access(
            account,
            requester,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        ),
        PortalSettingChangeRequestCreate(
            request_type="portal_setting_change",
            setting="browser_access_enabled",
            mode="override",
            value=True,
            reason="Browser needed for the project",
        ),
    )
    account.portal_settings_override = {
        "allow_portal_named_bucket_create": True,
        "allow_private_storage_space_create": False,
    }
    db_session.add(account)
    db_session.commit()

    approved = service.approve_request(created.id, admin)
    result = _stored_request_result(db_session, approved.id)

    db_session.refresh(account)
    stored = account.portal_settings_override
    assert stored == {
        "allow_portal_named_bucket_create": True,
        "allow_private_storage_space_create": False,
        "browser_access_enabled": True,
    }
    assert approved.status == "approved"
    assert result == {
        "setting": "browser_access_enabled",
        "mode": "override",
        "requested_value": True,
        "effective_value": True,
    }


def test_approve_setting_change_inherit_removes_only_requested_nested_override(db_session):
    account = _seed_account(db_session)
    account.portal_settings_override = {
        "browser_access_enabled": True,
        "bucket_defaults": {"versioning": False, "enable_cors": False},
    }
    db_session.add(account)
    db_session.commit()
    requester = _seed_user(db_session, email="manager@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = service.create_request(
        requester,
        _portal_access(
            account,
            requester,
            portal_role=PortalAccountRole.PORTAL_MANAGER.value,
        ),
        PortalSettingChangeRequestCreate(
            request_type="portal_setting_change",
            setting="bucket_defaults.versioning",
            mode="inherit",
        ),
    )

    service.approve_request(created.id, admin)

    db_session.refresh(account)
    stored = account.portal_settings_override
    assert stored == {
        "browser_access_enabled": True,
        "bucket_defaults": {"enable_cors": False},
    }


def test_create_quota_change_rejects_target_below_current_usage(db_session, monkeypatch):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")

    class FakePortalService:
        def __init__(self, db):  # noqa: ANN001
            self.db = db

        def get_usage(self, actor, access):  # noqa: ANN001
            return PortalUsage(
                used_bytes=12 * 1024**3,
                used_objects=None,
                quota_max_size_bytes=None,
                quota_max_objects=None,
                max_buckets=None,
                storage_spaces=[],
                other_storage_space=None,
            )

    monkeypatch.setattr("app.services.portal_requests_service.PortalService", FakePortalService)
    service = PortalRequestsService(db_session)

    with pytest.raises(ValueError, match="space already used"):
        service.create_request(
            requester,
            _portal_access(account, requester),
            PortalAccountQuotaChangeRequestCreate(
                request_type="account_quota_change",
                direction="decrease",
                target_quota_value=10,
                target_quota_unit="GiB",
                reason="Too low",
            ),
        )

    assert db_session.scalar(select(func.count()).select_from(PortalAdminRequest)) == 0


def test_create_quota_change_propagates_unexpected_usage_failures(db_session, monkeypatch):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")

    class FailingPortalService:
        def __init__(self, db):  # noqa: ANN001
            self.db = db

        def get_usage(self, actor, access):  # noqa: ANN001, ARG002
            raise TypeError("programming error")

    monkeypatch.setattr(
        "app.services.portal_requests_service.PortalService",
        FailingPortalService,
    )
    service = PortalRequestsService(db_session)

    with pytest.raises(TypeError, match="programming error"):
        service.create_request(
            requester,
            _portal_access(account, requester),
            PortalAccountQuotaChangeRequestCreate(
                request_type="account_quota_change",
                direction="decrease",
                target_quota_value=10,
                target_quota_unit="GiB",
                reason="Validate usage",
            ),
        )

    assert db_session.scalar(select(func.count()).select_from(PortalAdminRequest)) == 0


def test_quota_direction_mismatch_fails_request(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    fake_quota = FakeAccountQuotaOperations(quota=(10.0, None))
    service = PortalRequestsService(
        db_session,
        account_metrics=fake_quota,
        account_quota=fake_quota,
    )
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalAccountQuotaChangeRequestCreate(
            request_type="account_quota_change",
            direction="decrease",
            target_quota_value=12,
            target_quota_unit="GiB",
            reason="Wrong direction",
        ),
    )

    with pytest.raises(PortalRequestExecutionError):
        service.approve_request(created.id, admin)

    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    assert row.status == "failed"
    assert fake_quota.updates == []


def test_quota_approval_rejects_account_pending_deletion(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    fake_quota = FakeAccountQuotaOperations(quota=(10.0, 123))
    service = PortalRequestsService(
        db_session,
        account_metrics=fake_quota,
        account_quota=fake_quota,
    )
    created = service.create_request(
        requester,
        _portal_access(account, requester),
        PortalAccountQuotaChangeRequestCreate(
            request_type="account_quota_change",
            direction="increase",
            target_quota_value=12,
            target_quota_unit="GiB",
            reason="Need more capacity",
        ),
    )
    db_session.add(
        S3AccountDeletion(
            account_id=account.id,
            rgw_account_id=account.rgw_account_id,
            rgw_user_uid=account.rgw_user_uid,
            rgw_tenant=account.rgw_tenant,
            storage_endpoint_id=account.storage_endpoint_id,
        )
    )
    db_session.commit()

    with pytest.raises(PortalRequestExecutionError):
        service.approve_request(created.id, admin)

    row = db_session.get(PortalAdminRequest, created.id)
    assert row is not None
    assert row.status == "failed"
    assert fake_quota.updates == []


def test_reject_and_conflict_on_final_request(db_session):
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="requester@example.org")
    admin = _seed_user(db_session, email="admin@example.org", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    created = _create_user_request(service, account, requester)

    rejected = service.reject_request(created.id, admin, message="Missing information")

    assert rejected.status == "rejected"
    assert rejected.messages[0].message == "Missing information"
    with pytest.raises(PortalRequestConflict):
        service.approve_request(created.id, admin)


def test_platform_prohibition_rejects_new_and_previously_pending_activation_requests(db_session, monkeypatch):
    from app.models.app_settings import AppSettings
    from app.models.feature_policy import FeaturePolicy
    from app.services.portal_requests_service import PortalRequestExecutionError
    settings = AppSettings()
    settings.portal.feature_policies.user_external_sharing = FeaturePolicy.TARGETED
    monkeypatch.setattr("app.services.portal.settings.load_app_settings_for_db", lambda _db: settings)
    account = _seed_account(db_session)
    requester = _seed_user(db_session, email="policy-manager@example.test")
    admin = _seed_user(db_session, email="policy-admin@example.test", role=UserRole.UI_ADMIN.value)
    service = PortalRequestsService(db_session)
    access = _portal_access(account, requester, portal_role=PortalAccountRole.PORTAL_MANAGER.value)
    payload = PortalSettingChangeRequestCreate(request_type="portal_setting_change",
        setting="allow_portal_user_external_sharing", mode="override", value=True)
    created = service.create_request(requester, access, payload)
    settings.portal.feature_policies.user_external_sharing = FeaturePolicy.DISABLED
    with pytest.raises(ValueError, match="disabled by the platform"):
        service.create_request(requester, access, payload)
    with pytest.raises(PortalRequestExecutionError, match="disabled by the platform"):
        service.approve_request(created.id, admin)
    row = db_session.get(PortalAdminRequest, created.id)
    assert row.status == "failed"
    db_session.refresh(account)
    assert account.portal_settings_override is None
