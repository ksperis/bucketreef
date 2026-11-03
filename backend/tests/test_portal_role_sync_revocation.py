# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.domain_enums import PortalAccountRole
from app.db import AccountIAMUser, PortalIAMRevocation, User, UserS3Account
from app.services.portal.exceptions import PortalConflictError
from app.services.portal_role_sync import commit_portal_role_changes
from app.services.portal_service import PortalService
from tests.portal_iam_test_support import (
    FakePortalRevocationIAM,
    install_portal_revocation_fakes,
)
from tests.s3_account_factory import make_s3_account


def _seed_portal_identity(db_session, *, suffix: str, portal_role: str):
    account = make_s3_account(
        db_session,
        name=f"role-revocation-{suffix}",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    user = User(
        email=f"role-revocation-{suffix}@example.test",
        hashed_password="x",
        role="ui_user",
    )
    db_session.add_all([account, user])
    db_session.flush()
    association = UserS3Account(
        user_id=user.id,
        account_id=account.id,
        manager_role=None,
        portal_role=portal_role,
    )
    iam_link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id=f"iam-{suffix}",
        iam_username=f"portal-{suffix}",
        active_access_key=f"AK-{suffix.upper()}",
        active_secret_key=f"SK-{suffix.upper()}",
    )
    db_session.add_all([association, iam_link])
    db_session.commit()
    return account, user, association, iam_link


def test_role_removal_commit_failure_restores_disabled_portal_key(monkeypatch, db_session):
    account, user, association, iam_link = _seed_portal_identity(
        db_session,
        suffix="commit-rollback",
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )
    fake_iam = FakePortalRevocationIAM(iam_link.iam_username, iam_link.active_access_key)
    install_portal_revocation_fakes(monkeypatch, fake_iam)
    before = {(user.id, account.id): PortalAccountRole.PORTAL_USER.value}
    db_session.delete(association)
    db_session.flush()
    monkeypatch.setattr(
        db_session,
        "commit",
        lambda: (_ for _ in ()).throw(RuntimeError("simulated role commit failure")),
    )

    with pytest.raises(RuntimeError, match="simulated role commit failure"):
        commit_portal_role_changes(
            db_session,
            before=before,
            user_ids=[user.id],
            account_ids=[account.id],
        )

    restored_association = db_session.scalar(
        select(UserS3Account).where(
            UserS3Account.user_id == user.id,
            UserS3Account.account_id == account.id,
        )
    )
    restored_iam = db_session.scalar(
        select(AccountIAMUser).where(
            AccountIAMUser.user_id == user.id,
            AccountIAMUser.account_id == account.id,
        )
    )
    assert restored_association is not None
    assert restored_association.portal_role == PortalAccountRole.PORTAL_USER.value
    assert restored_iam is not None
    assert db_session.scalar(
        select(PortalIAMRevocation.id).where(
            PortalIAMRevocation.user_id == user.id,
            PortalIAMRevocation.account_id == account.id,
        )
    ) is None
    assert fake_iam.key_status == "Active"
    assert [call for call in fake_iam.calls if call[0] == "update_access_key_status"] == [
        ("update_access_key_status", iam_link.iam_username, iam_link.active_access_key, "Inactive"),
        ("update_access_key_status", iam_link.iam_username, iam_link.active_access_key, "Active"),
    ]


def test_role_removal_flush_failure_restores_disabled_portal_key(monkeypatch, db_session):
    account, user, association, iam_link = _seed_portal_identity(
        db_session,
        suffix="flush-rollback",
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )
    fake_iam = FakePortalRevocationIAM(iam_link.iam_username, iam_link.active_access_key)
    install_portal_revocation_fakes(monkeypatch, fake_iam)
    before = {(user.id, account.id): PortalAccountRole.PORTAL_USER.value}
    db_session.delete(association)
    db_session.flush()
    real_flush = db_session.flush
    flush_calls = 0

    def fail_revocation_flush(*args, **kwargs):
        nonlocal flush_calls
        flush_calls += 1
        if flush_calls == 1:
            raise RuntimeError("simulated revocation flush failure")
        return real_flush(*args, **kwargs)

    monkeypatch.setattr(db_session, "flush", fail_revocation_flush)

    with pytest.raises(RuntimeError, match="simulated revocation flush failure"):
        commit_portal_role_changes(
            db_session,
            before=before,
            user_ids=[user.id],
            account_ids=[account.id],
        )

    assert fake_iam.key_status == "Active"
    assert [call for call in fake_iam.calls if call[0] == "update_access_key_status"] == [
        ("update_access_key_status", iam_link.iam_username, iam_link.active_access_key, "Inactive"),
        ("update_access_key_status", iam_link.iam_username, iam_link.active_access_key, "Active"),
    ]


def test_role_downgrade_commit_failure_restores_previous_remote_role(monkeypatch, db_session):
    account, user, association, _iam_link = _seed_portal_identity(
        db_session,
        suffix="role-rollback",
        portal_role=PortalAccountRole.PORTAL_MANAGER.value,
    )
    before = {(user.id, account.id): PortalAccountRole.PORTAL_MANAGER.value}
    association.portal_role = PortalAccountRole.PORTAL_USER.value
    db_session.add(association)
    db_session.flush()
    synced_roles: list[str | None] = []
    monkeypatch.setattr(
        PortalService,
        "sync_existing_portal_user_access",
        lambda _service, _user, _account, role: synced_roles.append(role),
    )
    monkeypatch.setattr(
        db_session,
        "commit",
        lambda: (_ for _ in ()).throw(RuntimeError("simulated downgrade commit failure")),
    )

    with pytest.raises(RuntimeError, match="simulated downgrade commit failure"):
        commit_portal_role_changes(
            db_session,
            before=before,
            user_ids=[user.id],
            account_ids=[account.id],
        )

    db_session.refresh(association)
    assert association.portal_role == PortalAccountRole.PORTAL_MANAGER.value
    assert synced_roles == [
        PortalAccountRole.PORTAL_USER.value,
        PortalAccountRole.PORTAL_MANAGER.value,
    ]


def test_role_removal_cleanup_failure_is_pending_and_retryable(monkeypatch, db_session):
    account, user, association, iam_link = _seed_portal_identity(
        db_session,
        suffix="cleanup-retry",
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )
    fake_iam = FakePortalRevocationIAM(iam_link.iam_username, iam_link.active_access_key)
    fake_iam.fail_delete_key = True
    install_portal_revocation_fakes(monkeypatch, fake_iam)
    before = {(user.id, account.id): PortalAccountRole.PORTAL_USER.value}
    db_session.delete(association)
    db_session.flush()

    commit_portal_role_changes(
        db_session,
        before=before,
        user_ids=[user.id],
        account_ids=[account.id],
    )

    pending = db_session.scalar(
        select(PortalIAMRevocation).where(
            PortalIAMRevocation.user_id == user.id,
            PortalIAMRevocation.account_id == account.id,
        )
    )
    assert pending is not None
    assert pending.iam_username == iam_link.iam_username
    assert fake_iam.key_status == "Inactive"
    assert db_session.scalar(
        select(AccountIAMUser.id).where(
            AccountIAMUser.user_id == user.id,
            AccountIAMUser.account_id == account.id,
        )
    ) is None
    assert db_session.scalar(
        select(UserS3Account).where(
            UserS3Account.user_id == user.id,
            UserS3Account.account_id == account.id,
        )
    ) is None

    fake_iam.fail_delete_key = False
    commit_portal_role_changes(
        db_session,
        before={(user.id, account.id): None},
        user_ids=[user.id],
        account_ids=[account.id],
    )

    assert db_session.scalar(
        select(PortalIAMRevocation).where(
            PortalIAMRevocation.user_id == user.id,
            PortalIAMRevocation.account_id == account.id,
        )
    ) is None
    assert fake_iam.key_exists is False
    assert fake_iam.user_exists is False


def test_pending_revocation_blocks_portal_role_restoration(monkeypatch, db_session):
    account, user, association, iam_link = _seed_portal_identity(
        db_session,
        suffix="pending-promotion",
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )
    db_session.delete(association)
    db_session.delete(iam_link)
    db_session.add(
        PortalIAMRevocation(
            user_id=user.id,
            account_id=account.id,
            iam_user_id=iam_link.iam_user_id,
            iam_username=iam_link.iam_username,
        )
    )
    db_session.commit()
    replacement = UserS3Account(
        user_id=user.id,
        account_id=account.id,
        manager_role=None,
        portal_role=PortalAccountRole.PORTAL_USER.value,
    )
    db_session.add(replacement)
    db_session.flush()

    with pytest.raises(PortalConflictError, match="revocation is pending"):
        commit_portal_role_changes(
            db_session,
            before={(user.id, account.id): None},
            user_ids=[user.id],
            account_ids=[account.id],
        )

    assert db_session.scalar(
        select(UserS3Account).where(
            UserS3Account.user_id == user.id,
            UserS3Account.account_id == account.id,
        )
    ) is None
    pending = db_session.scalar(
        select(PortalIAMRevocation).where(
            PortalIAMRevocation.user_id == user.id,
            PortalIAMRevocation.account_id == account.id,
        )
    )
    assert pending is not None
