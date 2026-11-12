# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from sqlalchemy import select

from app.services.app_settings_service import enable_onboarding_features
from app.services.user_associations_service import UserAssociationsService
from app.db import S3Account, User, UserS3Account
from app.core.domain_enums import ManagerAccountRole, PortalAccountRole, UserRole
from tests.db_transaction_test_utils import fail_next_sqlite_statement_with_busy_snapshot
from tests.s3_account_factory import make_s3_account


def test_assign_account_creates_manager_link(db_session):
    # Seed account and user
    account = db_session.scalar(
        select(S3Account).where(
            S3Account.rgw_account_id == "RGW00000000000000001"
        )
    )
    if not account:
        account = make_s3_account(db_session, name="acc", rgw_account_id="RGW00000000000000001")
        db_session.add(account)
        db_session.flush()
    user = User(
        email="u@example.com",
        full_name="U",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()

    svc = UserAssociationsService(db_session)
    updated = svc.assign_account(
        user.id,
        account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
    )

    link = db_session.scalar(
        select(UserS3Account).where(
            UserS3Account.user_id == user.id,
            UserS3Account.account_id == account.id,
        )
    )
    assert link is not None
    assert link.manager_role == ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
    assert link.portal_role is None
    assert {link.account_id for link in updated.account_links} == {account.id}


def test_assign_account_updates_existing_link_without_widening_browser_access(
    db_session,
):
    enable_onboarding_features(db_session, ("portal_enabled",))
    account = make_s3_account(
        db_session,
        name="existing-link",
        rgw_account_id="RGW00000000000000002",
    )
    user = User(
        email="existing-link@example.com",
        full_name="Existing Link",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add_all([account, user])
    db_session.flush()
    link = UserS3Account(
        user_id=user.id,
        account_id=account.id,
        manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
        portal_role=None,
        allow_manager_browser_data_access=True,
    )
    db_session.add(link)
    db_session.commit()
    link_id = link.id

    UserAssociationsService(db_session).assign_account(
        user.id,
        account.id,
        manager_role=None,
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )

    db_session.refresh(link)
    assert link.id == link_id
    assert link.manager_role is None
    assert link.portal_role == PortalAccountRole.PORTAL_USER.value
    assert link.allow_manager_browser_data_access is True


def test_assign_account_retries_sqlite_write_intent_before_mutation(db_session):
    account = make_s3_account(
        db_session,
        name="busy-assignment",
        rgw_account_id="RGW00000000000000003",
    )
    user = User(
        email="busy-assignment@example.com",
        full_name="Busy Assignment",
        hashed_password="x",
        is_active=True,
        role=UserRole.UI_USER.value,
    )
    db_session.add_all([account, user])
    db_session.commit()

    with fail_next_sqlite_statement_with_busy_snapshot(
        db_session,
        "UPDATE users SET id =",
    ) as statements:
        UserAssociationsService(db_session).assign_account(
            user.id,
            account.id,
            manager_role=ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value,
            portal_role=None,
        )

    assert len(statements) == 2
    link = db_session.scalar(
        select(UserS3Account).where(
            UserS3Account.user_id == user.id,
            UserS3Account.account_id == account.id,
        )
    )
    assert link is not None
    assert link.manager_role == ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value


def test_portal_disabled_blocks_new_roles_and_allows_existing_role_removal(db_session):
    import pytest
    from app.services.portal.exceptions import PortalConflictError

    account = make_s3_account(db_session, name="Disabled Portal")
    user = User(email="disabled-portal@example.com", is_active=True, role=UserRole.UI_USER.value)
    db_session.add_all([account, user])
    db_session.flush()
    db_session.add(UserS3Account(
        user_id=user.id, account_id=account.id,
        manager_role="account_administrator", portal_role="portal_user",
    ))
    db_session.commit()

    service = UserAssociationsService(db_session)
    with pytest.raises(PortalConflictError, match="Portal is disabled"):
        service.assign_account(user.id, account.id, manager_role="account_administrator", portal_role="portal_manager")
    db_session.rollback()
    service.assign_account(user.id, account.id, manager_role="account_administrator", portal_role=None)

    link = db_session.scalars(select(UserS3Account)).one()
    assert link.portal_role is None
    assert link.manager_role == "account_administrator"
