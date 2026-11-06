# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.db import (
    AccountIAMUser,
    ApiToken,
    AuthSession,
    AuditLog,
    BucketMigration,
    PortalIAMRevocation,
    RefreshToken,
    S3Connection,
    S3User,
    User,
    UserS3Connection,
)
from app.core.domain_enums import UserRole
from app.services.users_service import UsersService
from app.db.tag_definition import TagDefinition
from app.services.portal_service import PortalService
from tests.portal_iam_test_support import (
    FakePortalRevocationIAM,
    install_portal_revocation_fakes,
)
from tests.s3_account_factory import make_s3_account
from tests.s3_connection_factory import custom_endpoint_fields


def test_delete_user_cleans_owned_connections_tokens_and_sessions(db_session):
    owner = User(email="owner-delete@example.com", hashed_password="x", role=UserRole.UI_USER.value)
    other = User(email="other-delete@example.com", hashed_password="x", role=UserRole.UI_ADMIN.value)
    db_session.add(owner)
    db_session.add(other)
    db_session.flush()

    owned_connection = S3Connection(
        created_by_user_id=owner.id,
        name="owned-private",
        **custom_endpoint_fields("https://owned-private.example.test"),
        access_key_id="AKIA-OWNED",
        secret_access_key="SECRET-OWNED",
    )
    shared_connection = S3Connection(
        created_by_user_id=other.id,
        name="other-private",
        **custom_endpoint_fields("https://other-private.example.test"),
        access_key_id="AKIA-OTHER",
        secret_access_key="SECRET-OTHER",
    )
    db_session.add(owned_connection)
    db_session.add(shared_connection)
    db_session.flush()
    owned_connection_id = owned_connection.id

    db_session.add(UserS3Connection(user_id=owner.id, s3_connection_id=shared_connection.id))
    db_session.add(UserS3Connection(user_id=other.id, s3_connection_id=owned_connection.id))

    own_token = ApiToken(
        id="tok-own",
        jti="jti-own",
        token_hash="hash-own",
        user_id=owner.id,
        name="own-token",
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    other_token = ApiToken(
        id="tok-other",
        jti="jti-other",
        token_hash="hash-other",
        user_id=other.id,
        name="other-token",
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    db_session.add(own_token)
    db_session.add(other_token)

    own_session = AuthSession(
        id="session-own",
        user_id=owner.id,
        auth_type="ui",
        principal_type="user",
        auth_version=1,
        last_activity_at=datetime(2026, 1, 1, tzinfo=UTC),
        idle_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        absolute_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        csrf_token_hash="csrf-own",
    )
    other_session = AuthSession(
        id="session-other",
        user_id=other.id,
        auth_type="ui",
        principal_type="user",
        auth_version=1,
        last_activity_at=datetime(2026, 1, 1, tzinfo=UTC),
        idle_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        absolute_expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        csrf_token_hash="csrf-other",
    )
    db_session.add_all([own_session, other_session])
    db_session.flush()
    own_refresh = RefreshToken(
        id="ref-own",
        family_id="family-own",
        auth_session_id=own_session.id,
        token_hash="ref-hash-own",
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    other_refresh = RefreshToken(
        id="ref-other",
        family_id="family-other",
        auth_session_id=other_session.id,
        token_hash="ref-hash-other",
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
    )
    db_session.add(own_refresh)
    db_session.add(other_refresh)

    db_session.commit()

    UsersService(db_session).delete_user(owner.id)

    assert db_session.scalar(select(User).where(User.id == owner.id)) is None
    assert db_session.scalar(
        select(S3Connection).where(S3Connection.id == owned_connection_id)
    ) is None
    assert db_session.scalar(
        select(UserS3Connection).where(UserS3Connection.user_id == owner.id)
    ) is None
    assert (
        db_session.scalar(
            select(UserS3Connection).where(
                UserS3Connection.s3_connection_id == owned_connection_id
            )
        )
        is None
    )
    assert db_session.scalar(select(ApiToken).where(ApiToken.id == "tok-own")) is None
    assert db_session.scalar(
        select(AuthSession).where(AuthSession.id == "session-own")
    ) is None
    assert db_session.scalar(
        select(RefreshToken).where(RefreshToken.id == "ref-own")
    ) is None
    token = db_session.scalar(select(ApiToken).where(ApiToken.id == "tok-other"))
    refresh = db_session.scalar(
        select(RefreshToken).where(RefreshToken.id == "ref-other")
    )
    assert token is not None
    assert refresh is not None


def test_delete_user_nulls_nullable_foreign_keys(db_session):
    user = User(email="delete-fk-user@example.com", hashed_password="x", role=UserRole.UI_ADMIN.value)
    db_session.add(user)
    db_session.flush()

    audit = AuditLog(
        user_id=user.id,
        user_email=user.email,
        user_role=user.role,
        scope="admin",
        action="delete_user_test",
    )
    migration = BucketMigration(
        created_by_user_id=user.id,
        source_context_id="10",
        target_context_id="20",
        mode="one_shot",
        copy_bucket_settings=False,
        lock_target_writes=True,
        use_same_endpoint_copy=False,
        auto_grant_source_read_for_copy=False,
        status="draft",
        parallelism_max=1,
        total_items=0,
    )
    tag_definition = TagDefinition(
        domain_kind="private_connection_user",
        owner_user_id=user.id,
        label="Delete user label",
        label_key="delete-user-label",
        color_key="slate",
    )
    db_session.add_all([audit, migration, tag_definition])
    db_session.commit()

    UsersService(db_session).delete_user(user.id)

    refreshed_audit = db_session.scalar(select(AuditLog).where(AuditLog.id == audit.id))
    refreshed_migration = db_session.scalar(
        select(BucketMigration).where(BucketMigration.id == migration.id)
    )
    refreshed_definition = db_session.scalar(
        select(TagDefinition).where(TagDefinition.id == tag_definition.id)
    )

    assert refreshed_audit is not None and refreshed_audit.user_id is None
    assert refreshed_migration is not None and refreshed_migration.created_by_user_id is None
    assert refreshed_definition is not None and refreshed_definition.owner_user_id is None


def _seed_portal_identity_for_user_deletion(db_session, *, suffix: str):
    user = User(
        email=f"delete-portal-{suffix}@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    account = make_s3_account(
        db_session,
        name=f"delete-portal-{suffix}",
        rgw_account_id=f"RGW-DELETE-{suffix.upper()}",
    )
    db_session.add_all([user, account])
    db_session.flush()
    link = AccountIAMUser(
        user_id=user.id,
        account_id=account.id,
        iam_user_id=f"iam-delete-{suffix}",
        iam_username=f"portal-delete-{suffix}",
        active_access_key=f"AK-DELETE-{suffix.upper()}",
        active_secret_key=f"SK-DELETE-{suffix.upper()}",
    )
    db_session.add(link)
    db_session.commit()
    return user, account, link


def test_delete_user_commit_failure_restores_portal_iam_identity(
    db_session,
    monkeypatch,
):
    user, account, link = _seed_portal_identity_for_user_deletion(
        db_session,
        suffix="rollback",
    )
    user_id = int(user.id)
    account_id = int(account.id)
    fake_iam = FakePortalRevocationIAM(link.iam_username, link.active_access_key)
    install_portal_revocation_fakes(monkeypatch, fake_iam)

    monkeypatch.setattr(
        db_session,
        "commit",
        lambda: (_ for _ in ()).throw(RuntimeError("simulated user delete commit failure")),
    )

    with pytest.raises(RuntimeError, match="simulated user delete commit failure"):
        UsersService(db_session).delete_user(user_id)

    assert db_session.get(User, user_id) is not None
    assert db_session.scalar(
        select(AccountIAMUser).where(
            AccountIAMUser.user_id == user_id,
            AccountIAMUser.account_id == account_id,
        )
    ) is not None
    assert db_session.scalar(
        select(PortalIAMRevocation).where(
            PortalIAMRevocation.user_id == user_id,
            PortalIAMRevocation.account_id == account_id,
        )
    ) is None
    assert fake_iam.key_status == "Active"


def test_delete_user_prepare_failure_restores_earlier_portal_iam_identity(
    db_session,
    monkeypatch,
):
    user = User(
        email="delete-portal-multi-account@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    first_account = make_s3_account(
        db_session,
        name="delete-portal-first",
        rgw_account_id="RGW-DELETE-FIRST",
    )
    second_account = make_s3_account(
        db_session,
        name="delete-portal-second",
        rgw_account_id="RGW-DELETE-SECOND",
    )
    db_session.add_all([user, first_account, second_account])
    db_session.flush()
    first_link = AccountIAMUser(
        user_id=user.id,
        account_id=first_account.id,
        iam_user_id="iam-delete-first",
        iam_username="portal-delete-first",
        active_access_key="AK-DELETE-FIRST",
        active_secret_key="SK-DELETE-FIRST",
    )
    second_link = AccountIAMUser(
        user_id=user.id,
        account_id=second_account.id,
        iam_user_id="iam-delete-second",
        iam_username="portal-delete-second",
        active_access_key="AK-DELETE-SECOND",
        active_secret_key="SK-DELETE-SECOND",
    )
    db_session.add_all([first_link, second_link])
    db_session.commit()

    first_iam = FakePortalRevocationIAM(
        first_link.iam_username,
        first_link.active_access_key,
    )
    second_iam = FakePortalRevocationIAM(
        second_link.iam_username,
        second_link.active_access_key,
    )
    second_iam.fail_get_user = True
    services_by_account = {
        int(first_account.id): first_iam,
        int(second_account.id): second_iam,
    }
    monkeypatch.setattr(
        PortalService,
        "_get_iam_service",
        lambda _service, account: services_by_account[int(account.id)],
    )

    with pytest.raises(RuntimeError, match="simulated IAM user lookup failure"):
        UsersService(db_session).delete_user(int(user.id))

    assert db_session.get(User, user.id) is not None
    assert db_session.scalar(
        select(AccountIAMUser.id).where(
            AccountIAMUser.user_id == user.id,
            AccountIAMUser.account_id == first_account.id,
        )
    ) is not None
    assert db_session.scalar(
        select(AccountIAMUser.id).where(
            AccountIAMUser.user_id == user.id,
            AccountIAMUser.account_id == second_account.id,
        )
    ) is not None
    assert db_session.scalar(
        select(PortalIAMRevocation.id).where(
            PortalIAMRevocation.user_id == user.id
        )
    ) is None
    assert first_iam.key_status == "Active"
    assert second_iam.key_status == "Active"


def test_delete_user_keeps_failed_portal_iam_cleanup_reconcilable(
    db_session,
    monkeypatch,
):
    user, account, link = _seed_portal_identity_for_user_deletion(
        db_session,
        suffix="pending",
    )
    user_id = int(user.id)
    account_id = int(account.id)
    fake_iam = FakePortalRevocationIAM(link.iam_username, link.active_access_key)
    fake_iam.fail_delete_key = True
    install_portal_revocation_fakes(monkeypatch, fake_iam)

    UsersService(db_session).delete_user(user_id)

    assert db_session.get(User, user_id) is None
    assert db_session.scalar(
        select(AccountIAMUser).where(
            AccountIAMUser.user_id == user_id,
            AccountIAMUser.account_id == account_id,
        )
    ) is None
    pending = db_session.scalar(
        select(PortalIAMRevocation).where(
            PortalIAMRevocation.user_id == user_id,
            PortalIAMRevocation.account_id == account_id,
        )
    )
    assert pending is not None
    assert pending.iam_username == link.iam_username
    assert fake_iam.key_status == "Inactive"

    fake_iam.fail_delete_key = False
    assert PortalService(db_session)._finalize_portal_iam_revocation(
        user_id=user_id,
        account_id=account_id,
    ) is True
    assert db_session.scalar(
        select(PortalIAMRevocation).where(
            PortalIAMRevocation.user_id == user_id,
            PortalIAMRevocation.account_id == account_id,
        )
    ) is None
    assert fake_iam.key_exists is False
    assert fake_iam.user_exists is False
