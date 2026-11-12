# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from datetime import UTC, datetime
import sqlite3

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.domain_errors import CompensationFailureError
from app.db import (
    AccountIAMUser,
    ApiToken,
    AuthSession,
    AuditLog,
    BucketMigration,
    ManagedPrivateAccess,
    PortalIAMRevocation,
    PortalPublicLink,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    RefreshToken,
    S3Connection,
    S3User,
    User,
    UserS3Connection,
)
from app.core.domain_enums import UserRole
from app.services.user_deletion_service import UserDeletionService
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

    UserDeletionService(db_session).delete_user(owner.id)

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


def test_delete_user_cleans_managed_private_access_before_owned_connection(
    db_session,
    monkeypatch,
):
    owner = User(
        email="owner-managed-delete@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    db_session.add(owner)
    db_session.flush()
    connection = S3Connection(
        created_by_user_id=owner.id,
        name="owned-managed-private",
        **custom_endpoint_fields("https://managed-private.example.test"),
        access_key_id="AKIA-MANAGED-OWNED",
        secret_access_key="SECRET-MANAGED-OWNED",
        server_managed=True,
    )
    db_session.add(connection)
    db_session.flush()
    provisioning = ManagedPrivateAccess(
        owner_user_id=owner.id,
        source_context_type="account",
        source_context_id=42,
        remote_principal_type="iam_user",
        remote_principal_identifier="managed-user",
        iam_username="managed-user",
        access_key_id="AKIA-MANAGED-OWNED",
        s3_connection_id=connection.id,
        state="active",
        created_remote_principal=True,
        created_access_key=True,
    )
    db_session.add(provisioning)
    db_session.commit()
    owner_id = int(owner.id)
    connection_id = int(connection.id)
    provisioning_id = int(provisioning.id)
    cleanup_calls: list[tuple[int, int, bool]] = []

    def cleanup_managed_connection(
        service,
        *,
        user,
        connection_id,
        use_persisted_source=False,
    ):
        cleanup_calls.append(
            (int(user.id), int(connection_id), bool(use_persisted_source))
        )
        managed = service.db.get(ManagedPrivateAccess, provisioning_id)
        row = service.db.get(S3Connection, connection_id)
        if managed is not None:
            service.db.delete(managed)
        if row is not None:
            service.db.delete(row)
        service.db.commit()
        return True

    monkeypatch.setattr(
        "app.services.managed_private_access_cleanup_service.ManagedPrivateAccessCleanupService.delete_owned_connection",
        cleanup_managed_connection,
    )

    UserDeletionService(db_session).delete_user(owner_id)

    assert cleanup_calls == [(owner_id, connection_id, True)]
    assert db_session.get(User, owner_id) is None
    assert db_session.get(ManagedPrivateAccess, provisioning_id) is None
    assert db_session.get(S3Connection, connection_id) is None


def test_delete_user_removes_compensated_failed_managed_private_access(db_session):
    owner = User(
        email="owner-managed-failed-delete@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    db_session.add(owner)
    db_session.flush()
    provisioning = ManagedPrivateAccess(
        owner_user_id=owner.id,
        source_context_type="account",
        source_context_id=43,
        remote_principal_type="iam_user",
        remote_principal_identifier="failed-managed-user",
        iam_username="failed-managed-user",
        state="failed",
        cleanup_error="provisioning failed after successful compensation",
    )
    db_session.add(provisioning)
    db_session.commit()
    owner_id = int(owner.id)
    provisioning_id = int(provisioning.id)

    UserDeletionService(db_session).delete_user(owner_id)

    assert db_session.get(User, owner_id) is None
    assert db_session.get(ManagedPrivateAccess, provisioning_id) is None


def test_delete_user_rejects_in_progress_managed_private_access_without_connection(
    db_session,
):
    owner = User(
        email="owner-managed-provisioning-delete@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    db_session.add(owner)
    db_session.flush()
    provisioning = ManagedPrivateAccess(
        owner_user_id=owner.id,
        source_context_type="account",
        source_context_id=44,
        remote_principal_type="iam_user",
        remote_principal_identifier="provisioning-managed-user",
        iam_username="provisioning-managed-user",
        state="provisioning",
    )
    db_session.add(provisioning)
    db_session.commit()
    owner_id = int(owner.id)

    with pytest.raises(ValueError, match="managed private access provisioning is still active"):
        UserDeletionService(db_session).delete_user(owner_id)

    assert db_session.get(User, owner_id) is not None
    assert db_session.get(ManagedPrivateAccess, provisioning.id) is not None


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
        maintenance_requested_by_user_id=user.id,
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

    UserDeletionService(db_session).delete_user(user.id)

    refreshed_audit = db_session.scalar(select(AuditLog).where(AuditLog.id == audit.id))
    refreshed_migration = db_session.scalar(
        select(BucketMigration).where(BucketMigration.id == migration.id)
    )
    refreshed_definition = db_session.scalar(
        select(TagDefinition).where(TagDefinition.id == tag_definition.id)
    )

    assert refreshed_audit is not None and refreshed_audit.user_id is None
    assert refreshed_migration is not None and refreshed_migration.created_by_user_id is None
    assert refreshed_migration.maintenance_requested_by_user_id is None
    assert refreshed_definition is not None and refreshed_definition.owner_user_id is None


def test_delete_user_nulls_retained_portal_creator_references(db_session):
    creator = User(
        email="delete-portal-creator@example.com",
        hashed_password="x",
        role=UserRole.UI_ADMIN.value,
    )
    recipient = User(
        email="delete-portal-recipient@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    account = make_s3_account(
        db_session,
        name="delete-portal-creator-account",
        rgw_access_key="ROOT-AK",
        rgw_secret_key="ROOT-SK",
    )
    db_session.add_all([account, creator, recipient])
    db_session.flush()
    metadata = PortalStorageSpaceMetadata(
        account_id=account.id,
        bucket_name="shared-data",
        visibility="shared",
    )
    db_session.add(metadata)
    db_session.flush()
    grant = PortalStorageSpaceGrant(
        storage_space_metadata_id=metadata.id,
        user_id=recipient.id,
        role="Viewer",
        created_by_user_id=creator.id,
    )
    public_link = PortalPublicLink(
        token="delete-portal-creator-token",
        account_id=account.id,
        bucket_name="shared-data",
        object_key="report.csv",
        created_by_user_id=creator.id,
        created_by_email=creator.email,
    )
    db_session.add_all([grant, public_link])
    db_session.commit()
    creator_id = int(creator.id)
    grant_id = int(grant.id)
    public_link_id = int(public_link.id)

    UserDeletionService(db_session).delete_user(creator_id)

    refreshed_grant = db_session.get(PortalStorageSpaceGrant, grant_id)
    refreshed_link = db_session.get(PortalPublicLink, public_link_id)
    assert db_session.get(User, creator_id) is None
    assert refreshed_grant is not None and refreshed_grant.created_by_user_id is None
    assert refreshed_link is not None and refreshed_link.created_by_user_id is None
    assert refreshed_link.created_by_email == "delete-portal-creator@example.com"


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


def test_delete_user_retries_sqlite_write_intent_before_portal_revocation(
    db_session,
    monkeypatch,
):
    user, account, link = _seed_portal_identity_for_user_deletion(
        db_session,
        suffix="busy-write-intent",
    )
    user_id = int(user.id)
    account_id = int(account.id)
    fake_iam = FakePortalRevocationIAM(link.iam_username, link.active_access_key)
    install_portal_revocation_fakes(monkeypatch, fake_iam)
    real_execute = db_session.execute
    write_intent_calls = 0

    def busy_write_intent_once(statement, *args, **kwargs):
        nonlocal write_intent_calls
        if str(statement).startswith("UPDATE users SET id = id"):
            write_intent_calls += 1
            if write_intent_calls == 1:
                original = sqlite3.OperationalError("database is locked")
                original.sqlite_errorcode = sqlite3.SQLITE_BUSY_SNAPSHOT
                raise OperationalError("UPDATE users SET id = id", (), original)
        return real_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", busy_write_intent_once)

    UserDeletionService(db_session).delete_user(user_id)

    assert write_intent_calls == 2
    assert db_session.get(User, user_id) is None
    assert db_session.scalar(
        select(AccountIAMUser).where(
            AccountIAMUser.user_id == user_id,
            AccountIAMUser.account_id == account_id,
        )
    ) is None
    assert fake_iam.key_exists is False
    assert fake_iam.user_exists is False


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
        UserDeletionService(db_session).delete_user(user_id)

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
        UserDeletionService(db_session).delete_user(int(user.id))

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


def test_delete_user_prepare_failure_types_failed_compensation(
    db_session,
    monkeypatch,
):
    user, _account, _link = _seed_portal_identity_for_user_deletion(
        db_session,
        suffix="prepare-compensation-failure",
    )
    service = UserDeletionService(db_session)
    monkeypatch.setattr(
        PortalService,
        "_prepare_portal_iam_revocation",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("simulated Portal preparation failure")
        ),
    )
    monkeypatch.setattr(
        service,
        "_rollback_portal_revocation_transaction",
        lambda _preparations: True,
    )

    with pytest.raises(
        CompensationFailureError,
        match="Unable to prepare Portal IAM revocations",
    ) as raised:
        service.delete_user(int(user.id))

    assert isinstance(raised.value.__cause__, RuntimeError)
    assert str(raised.value.__cause__) == "simulated Portal preparation failure"


def test_delete_user_failure_types_failed_compensation(
    db_session,
    monkeypatch,
):
    user = User(
        email="delete-compensation-failure@example.com",
        hashed_password="x",
        role=UserRole.UI_USER.value,
    )
    db_session.add(user)
    db_session.commit()
    service = UserDeletionService(db_session)
    monkeypatch.setattr(service, "_prepare_portal_revocations", lambda _user: [])
    monkeypatch.setattr(
        service,
        "_delete_links_and_private_connections",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("simulated local deletion failure")
        ),
    )
    monkeypatch.setattr(
        service,
        "_rollback_portal_revocation_transaction",
        lambda _preparations: True,
    )

    with pytest.raises(
        CompensationFailureError,
        match="Unable to delete user",
    ) as raised:
        service.delete_user(int(user.id))

    assert isinstance(raised.value.__cause__, RuntimeError)
    assert str(raised.value.__cause__) == "simulated local deletion failure"


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

    UserDeletionService(db_session).delete_user(user_id)

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
