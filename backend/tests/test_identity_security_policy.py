# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.db import UiGroup, UiGroupS3Account, UiGroupS3User, User, UserS3Account, UserS3User
from app.core.domain_enums import UserRole
from app.models.ui_group import UiGroupUpdate
from app.models.user import AccountMembership, S3UserMembership, UserUpdate
from app.services.identity_security_policy import (
    admin_group_update_requires_step_up,
    admin_user_update_requires_step_up,
)


def test_s3_user_browser_access_change_requires_step_up_for_users_and_groups():
    user = User(
        email="policy-user@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    user.s3_user_links = [
        UserS3User(
            s3_user_id=41,
            allow_manager_browser_data_access=False,
        )
    ]
    group = UiGroup(name="Policy group")
    group.s3_user_links = [
        UiGroupS3User(
            s3_user_id=41,
            allow_manager_browser_data_access=False,
        )
    ]

    unchanged = [
        S3UserMembership(
            s3_user_id=41,
            allow_manager_browser_data_access=False,
        )
    ]
    expanded = [
        S3UserMembership(
            s3_user_id=41,
            allow_manager_browser_data_access=True,
        )
    ]

    assert admin_user_update_requires_step_up(
        user,
        UserUpdate(s3_user_links=unchanged),
    ) is False
    assert admin_group_update_requires_step_up(
        group,
        UiGroupUpdate(s3_user_links=unchanged),
    ) is False
    assert admin_user_update_requires_step_up(
        user,
        UserUpdate(s3_user_links=expanded),
    ) is True
    assert admin_group_update_requires_step_up(
        group,
        UiGroupUpdate(s3_user_links=expanded),
    ) is True


def test_account_browser_access_change_requires_step_up_for_users_and_groups():
    user = User(
        email="policy-account-user@example.test",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    user.account_links = [
        UserS3Account(
            account_id=51,
            manager_role="account_administrator",
            portal_role=None,
            allow_manager_browser_data_access=False,
        )
    ]
    group = UiGroup(name="Policy account group")
    group.account_links = [
        UiGroupS3Account(
            account_id=51,
            manager_role="account_administrator",
            portal_role=None,
            allow_manager_browser_data_access=False,
        )
    ]

    unchanged = [
        AccountMembership(
            account_id=51,
            manager_role="account_administrator",
            portal_role=None,
            allow_manager_browser_data_access=False,
        )
    ]
    expanded = [
        AccountMembership(
            account_id=51,
            manager_role="account_administrator",
            portal_role=None,
            allow_manager_browser_data_access=True,
        )
    ]

    assert admin_user_update_requires_step_up(
        user,
        UserUpdate(account_links=unchanged),
    ) is False
    assert admin_group_update_requires_step_up(
        group,
        UiGroupUpdate(account_links=unchanged),
    ) is False
    assert admin_user_update_requires_step_up(
        user,
        UserUpdate(account_links=expanded),
    ) is True
    assert admin_group_update_requires_step_up(
        group,
        UiGroupUpdate(account_links=expanded),
    ) is True
