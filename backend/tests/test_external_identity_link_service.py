# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.domain_errors import ExternalIdentityConflictError
from app.core.security import get_password_hash
from app.db import (
    AuthSession,
    ExternalIdentity,
    ExternalIdentityLinkAttempt,
    ExternalIdentityLinkRequest,
    User,
    UserNotification,
)
from app.core.domain_enums import UserRole
from app.models.external_identity_link import ExternalIdentityProfileOidcStartRequest
from app.services.api_token_service import ApiTokenService
from app.services.auth_session_service import AuthSessionService
from app.services.ldap_service import LDAPIdentity
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.external_identity_link_contracts import ExternalIdentityLinkError
from app.services.external_identity_link_service import ExternalIdentityLinkService
from app.utils.time import utcnow


OIDC_ISSUER = "https://issuer.example.test"
BROWSER_HASH = "browser-binding-hash"


def _user(db_session, *, email: str, role: str = UserRole.UI_USER.value) -> User:
    row = User(
        email=email,
        full_name="OIDC Link Test",
        hashed_password=get_password_hash("correct horse battery staple"),
        is_active=True,
        role=role,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _attempt(db_session, user: User, *, subject: str = "new-subject") -> ExternalIdentityLinkAttempt:
    return ExternalIdentityLinkService(db_session).create_login_collision_attempt(
        user=user,
        provider_type="oidc",
        provider_id="company",
        issuer=OIDC_ISSUER,
        subject=subject,
        email=user.email,
        email_verified=True,
        display_name=user.full_name,
        picture_url=None,
        browser_secret_hash=BROWSER_HASH,
        redirect_path="/",
    )


def _ldap_attempt(db_session, user: User, *, subject: str = "ldap-new-subject") -> ExternalIdentityLinkAttempt:
    return ExternalIdentityLinkService(db_session).create_login_collision_attempt(
        user=user,
        provider_type="ldap",
        provider_id="corp",
        issuer=None,
        subject=subject,
        email=user.email,
        email_verified=False,
        display_name=user.full_name,
        picture_url=None,
        browser_secret_hash=BROWSER_HASH,
        redirect_path="/",
    )


def test_link_attempt_is_browser_bound_and_expires(db_session):
    user = _user(db_session, email="browser-bound@example.test")
    attempt = _attempt(db_session, user)
    service = ExternalIdentityLinkService(db_session)

    with pytest.raises(ExternalIdentityLinkError, match="browser binding mismatch"):
        service.status(attempt.id, "wrong-browser")

    attempt.expires_at = utcnow() - timedelta(seconds=1)
    db_session.add(attempt)
    db_session.commit()
    with pytest.raises(ExternalIdentityLinkError, match="expired"):
        service.status(attempt.id, BROWSER_HASH)


def test_profile_oidc_link_redirect_path_is_limited_to_internal_profile_routes():
    payload = ExternalIdentityProfileOidcStartRequest(
        redirect_path="/browser/profile?tab=security",
    )
    assert payload.redirect_path == "/browser/profile?tab=security"

    with pytest.raises(ValidationError, match="BucketReef profile route"):
        ExternalIdentityProfileOidcStartRequest(
            redirect_path="https://evil.example.test/profile",
        )


def test_profile_link_preserves_mfa_time_and_requires_fresh_step_up(db_session, monkeypatch):
    user = _user(db_session, email="profile-link@example.test")
    service = ExternalIdentityLinkService(db_session)
    verified_at = utcnow() - timedelta(minutes=service.settings.mfa_recent_minutes - 1)
    attempt = service.create_profile_attempt(
        user=user,
        provider_id="company",
        issuer=OIDC_ISSUER,
        browser_secret_hash=BROWSER_HASH,
        mfa_verified_at=verified_at,
        redirect_path="/manager/profile?tab=security",
    )
    monkeypatch.setattr(
        "app.services.external_identity_link_service.WebAuthnService.has_credentials",
        lambda _service, _user_id: True,
    )

    status = service.record_oidc_identity(
        attempt_id=attempt.id,
        browser_secret_hash=BROWSER_HASH,
        provider_id="company",
        issuer=OIDC_ISSUER,
        subject="profile-subject",
        email=user.email,
        full_name=user.full_name,
        picture_url=None,
        email_verified=True,
    )

    db_session.refresh(attempt)
    assert attempt.mfa_verified_at == verified_at
    assert status.redirect_path == "/manager/profile?tab=security"
    assert status.stage == "confirm"

    attempt.mfa_verified_at = utcnow() - timedelta(minutes=service.settings.mfa_recent_minutes + 1)
    db_session.add(attempt)
    db_session.commit()

    assert service.status(attempt.id, BROWSER_HASH).stage == "mfa"
    with pytest.raises(ExternalIdentityLinkError, match="not ready for confirmation"):
        service.confirm(
            attempt.id,
            BROWSER_HASH,
            ip_address="127.0.0.1",
            user_agent="pytest",
        )


def test_password_and_linked_ldap_can_prove_target_account(db_session, monkeypatch):
    user = _user(db_session, email="proof@example.test")
    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type="ldap",
            provider_id="corp",
            subject="uid=proof,dc=example,dc=test",
            email=user.email,
            email_verified=False,
        )
    )
    db_session.commit()
    service = ExternalIdentityLinkService(db_session)

    password_attempt = _attempt(db_session, user, subject="password-target")
    with pytest.raises(ExternalIdentityLinkError, match="Invalid account password"):
        service.verify_password(password_attempt.id, BROWSER_HASH, "wrong-password")
    status = service.verify_password(
        password_attempt.id,
        BROWSER_HASH,
        "correct horse battery staple",
    )
    assert status.stage == "confirm"

    class FakeLdapService:
        def __init__(self, *_args, **_kwargs):
            pass

        def verify_credentials(self, provider_id, username, password):
            assert (provider_id, username, password) == ("corp", "proof", "ldap-password")
            return LDAPIdentity(
                provider="corp",
                subject="uid=proof,dc=example,dc=test",
                dn="uid=proof,dc=example,dc=test",
            )

    monkeypatch.setattr("app.services.external_identity_link_service.LDAPAuthService", FakeLdapService)
    ldap_attempt = _attempt(db_session, user, subject="ldap-target")
    status = service.verify_ldap(
        ldap_attempt.id,
        BROWSER_HASH,
        provider_id="corp",
        username="proof",
        password="ldap-password",
    )
    assert status.stage == "confirm"


def test_admin_fallback_creates_review_request_and_stops_local_flow(db_session):
    user = _user(db_session, email="fallback@example.test")
    attempt = _attempt(db_session, user)
    initial_expiry = attempt.expires_at
    service = ExternalIdentityLinkService(db_session)

    request = service.request_admin_approval(attempt.id, BROWSER_HASH)

    assert request.user_id == user.id
    assert request.provider_type == "oidc"
    assert request.issuer == OIDC_ISSUER
    assert request.subject == "new-subject"
    assert request.email_verified is True
    assert request.request_source == "login_collision"
    db_session.refresh(attempt)
    assert attempt.expires_at == request.expires_at
    assert attempt.expires_at > initial_expiry
    assert service.status(attempt.id, BROWSER_HASH).stage == "admin_requested"

    superadmin = _user(
        db_session,
        email="fallback-superadmin@example.test",
        role=UserRole.UI_SUPERADMIN.value,
    )
    ExternalIdentityUserService(db_session).decide_link_request(
        request.id,
        superadmin=superadmin,
        approve=True,
    )
    assert service.status(attempt.id, BROWSER_HASH).stage == "admin_approved"
    identity = db_session.scalars(
        select(ExternalIdentity).where(
            ExternalIdentity.user_id == user.id,
            ExternalIdentity.provider_type == "oidc",
        )
    ).one()
    assert identity.email_verified is True
    notification = db_session.scalars(
        select(UserNotification).where(
            UserNotification.user_id == user.id,
            UserNotification.notification_type == "identity_changed",
        )
    ).one()
    assert notification.payload["status"] == "approved"
    assert "subject" not in notification.payload


def test_admin_fallback_rolls_back_request_and_attempt_when_commit_fails(
    db_session,
    monkeypatch,
):
    user = _user(db_session, email="fallback-request-rollback@example.test")
    attempt = _attempt(db_session, user, subject="fallback-request-rollback-subject")
    original_expiry = attempt.expires_at
    original_rollback = db_session.rollback
    rollback_calls = []
    commit_calls = 0

    def failing_commit():
        nonlocal commit_calls
        commit_calls += 1
        raise RuntimeError("commit failed")

    def recording_rollback():
        rollback_calls.append(True)
        original_rollback()

    monkeypatch.setattr(db_session, "commit", failing_commit)
    monkeypatch.setattr(db_session, "rollback", recording_rollback)

    with pytest.raises(RuntimeError, match="commit failed"):
        ExternalIdentityLinkService(db_session).request_admin_approval(
            attempt.id,
            BROWSER_HASH,
        )

    assert commit_calls == 1
    assert rollback_calls == [True]
    db_session.expire_all()
    restored_attempt = db_session.get(ExternalIdentityLinkAttempt, attempt.id)
    assert restored_attempt is not None and restored_attempt.status == "pending"
    assert restored_attempt.expires_at == original_expiry
    assert db_session.scalars(
        select(ExternalIdentityLinkRequest).where(
            ExternalIdentityLinkRequest.subject == "fallback-request-rollback-subject"
        )
    ).all() == []


def test_admin_fallback_rejection_reaches_terminal_link_state(db_session):
    user = _user(db_session, email="fallback-rejected@example.test")
    attempt = _attempt(db_session, user, subject="rejected-subject")
    service = ExternalIdentityLinkService(db_session)
    request = service.request_admin_approval(attempt.id, BROWSER_HASH)
    superadmin = _user(
        db_session,
        email="fallback-reject-superadmin@example.test",
        role=UserRole.UI_SUPERADMIN.value,
    )

    ExternalIdentityUserService(db_session).decide_link_request(
        request.id,
        superadmin=superadmin,
        approve=False,
    )

    assert service.status(attempt.id, BROWSER_HASH).stage == "admin_rejected"
    notification = db_session.scalars(
        select(UserNotification).where(
            UserNotification.user_id == user.id,
            UserNotification.notification_type == "identity_changed",
        )
    ).one()
    assert notification.payload["status"] == "rejected"


def test_admin_link_approval_rolls_back_identity_and_credentials_on_commit_failure(
    db_session,
    monkeypatch,
):
    user = _user(
        db_session,
        email="approval-rollback@example.test",
        role=UserRole.UI_ADMIN.value,
    )
    credentials = AuthSessionService(db_session).create_for_user(
        user,
        auth_type="test",
        ip_address="127.0.0.1",
        user_agent="pytest",
        mfa_verified=True,
    )
    _, api_token = ApiTokenService(db_session).create_for_user(
        user,
        name="approval rollback token",
        scopes=["profile:read"],
    )
    attempt = _attempt(db_session, user, subject="approval-rollback-subject")
    service = ExternalIdentityLinkService(db_session)
    request = service.request_admin_approval(attempt.id, BROWSER_HASH)
    superadmin = _user(
        db_session,
        email="approval-rollback-superadmin@example.test",
        role=UserRole.UI_SUPERADMIN.value,
    )
    original_version = user.auth_version
    original_rollback = db_session.rollback
    rollback_calls = []

    def failing_commit():
        raise RuntimeError("commit failed")

    def recording_rollback():
        rollback_calls.append(True)
        original_rollback()

    monkeypatch.setattr(db_session, "commit", failing_commit)
    monkeypatch.setattr(db_session, "rollback", recording_rollback)

    with pytest.raises(RuntimeError, match="commit failed"):
        ExternalIdentityUserService(db_session).decide_link_request(
            request.id,
            superadmin=superadmin,
            approve=True,
        )

    assert rollback_calls == [True]
    db_session.expire_all()
    restored_request = db_session.get(type(request), request.id)
    restored_attempt = db_session.get(ExternalIdentityLinkAttempt, attempt.id)
    restored_user = db_session.get(User, user.id)
    restored_session = db_session.get(type(credentials.session), credentials.session.id)
    db_session.refresh(api_token)
    assert restored_request is not None and restored_request.status == "pending"
    assert restored_attempt is not None and restored_attempt.status == "admin_requested"
    assert restored_user is not None and restored_user.auth_version == original_version
    assert restored_session is not None and restored_session.revoked_at is None
    assert api_token.revoked_at is None
    assert db_session.scalars(
        select(ExternalIdentity).where(ExternalIdentity.subject == "approval-rollback-subject")
    ).all() == []
    assert db_session.scalars(
        select(UserNotification).where(
            UserNotification.event_key.like(f"external_identity_link_decision:{request.id}:%")
        )
    ).all() == []


def test_confirm_revokes_existing_credentials_and_creates_replacement_session(db_session):
    user = _user(db_session, email="confirm@example.test", role=UserRole.UI_ADMIN.value)
    original_version = user.auth_version
    old_credentials = AuthSessionService(db_session).create_for_user(
        user,
        auth_type="test",
        ip_address="127.0.0.1",
        user_agent="pytest",
        mfa_verified=True,
    )
    _, api_token = ApiTokenService(db_session).create_for_user(
        user,
        name="pre-link token",
        scopes=["admin"],
    )
    attempt = _attempt(db_session, user)
    attempt.proof_method = "password"
    attempt.proof_verified_at = utcnow()
    attempt.mfa_verified_at = utcnow()
    db_session.add(attempt)
    db_session.commit()

    completion = ExternalIdentityLinkService(db_session).confirm(
        attempt.id,
        BROWSER_HASH,
        ip_address="127.0.0.1",
        user_agent="pytest",
    )

    db_session.refresh(user)
    db_session.refresh(old_credentials.session)
    db_session.refresh(api_token)
    assert user.auth_version == original_version + 1
    assert old_credentials.session.revoked_at is not None
    assert api_token.revoked_at is not None
    assert completion.credentials.session.id != old_credentials.session.id
    assert completion.credentials.session.revoked_at is None
    assert completion.credentials.session.auth_version == user.auth_version
    assert completion.identity.issuer == OIDC_ISSUER
    assert completion.identity.subject == "new-subject"
    assert db_session.scalar(
        select(UserNotification).where(
            UserNotification.user_id == user.id,
            UserNotification.notification_type == "identity_changed",
        )
    ) is not None


def test_confirm_rolls_back_identity_and_replacement_credentials_when_commit_fails(
    db_session,
    monkeypatch,
):
    user = _user(
        db_session,
        email="confirm-rollback@example.test",
        role=UserRole.UI_ADMIN.value,
    )
    original_version = user.auth_version
    old_credentials = AuthSessionService(db_session).create_for_user(
        user,
        auth_type="test",
        ip_address="127.0.0.1",
        user_agent="pytest",
        mfa_verified=True,
    )
    _, api_token = ApiTokenService(db_session).create_for_user(
        user,
        name="confirm rollback token",
        scopes=["profile:read"],
    )
    attempt = _attempt(db_session, user, subject="confirm-rollback-subject")
    attempt.proof_method = "password"
    attempt.proof_verified_at = utcnow()
    attempt.mfa_verified_at = utcnow()
    db_session.add(attempt)
    db_session.commit()
    original_rollback = db_session.rollback
    rollback_calls = []
    commit_calls = 0

    def failing_commit():
        nonlocal commit_calls
        commit_calls += 1
        raise RuntimeError("commit failed")

    def recording_rollback():
        rollback_calls.append(True)
        original_rollback()

    monkeypatch.setattr(db_session, "commit", failing_commit)
    monkeypatch.setattr(db_session, "rollback", recording_rollback)

    with pytest.raises(RuntimeError, match="commit failed"):
        ExternalIdentityLinkService(db_session).confirm(
            attempt.id,
            BROWSER_HASH,
            ip_address="127.0.0.1",
            user_agent="pytest",
        )

    assert commit_calls == 1
    assert rollback_calls == [True]
    db_session.expire_all()
    restored_user = db_session.get(User, user.id)
    restored_attempt = db_session.get(ExternalIdentityLinkAttempt, attempt.id)
    restored_session = db_session.get(AuthSession, old_credentials.session.id)
    db_session.refresh(api_token)
    assert restored_user is not None and restored_user.auth_version == original_version
    assert restored_attempt is not None and restored_attempt.status == "pending"
    assert restored_attempt.consumed_at is None
    assert restored_session is not None and restored_session.revoked_at is None
    assert api_token.revoked_at is None
    assert db_session.scalars(
        select(ExternalIdentity).where(ExternalIdentity.subject == "confirm-rollback-subject")
    ).all() == []
    sessions = db_session.scalars(select(AuthSession).where(AuthSession.user_id == user.id)).all()
    assert [session.id for session in sessions] == [old_credentials.session.id]
    assert db_session.scalars(
        select(UserNotification).where(
            UserNotification.event_key.like("external_identity_linked:%")
        )
    ).all() == []


def test_ldap_link_can_be_confirmed_after_proving_target_local_password(db_session):
    user = _user(db_session, email="ldap-confirm@example.test")
    attempt = _ldap_attempt(db_session, user)
    service = ExternalIdentityLinkService(db_session)

    status = service.verify_password(
        attempt.id,
        BROWSER_HASH,
        "correct horse battery staple",
    )
    assert status.provider_type == "ldap"
    assert status.stage == "confirm"

    completion = service.confirm(
        attempt.id,
        BROWSER_HASH,
        ip_address="127.0.0.1",
        user_agent="pytest",
    )

    assert completion.identity.provider_type == "ldap"
    assert completion.identity.provider_id == "corp"
    assert completion.identity.issuer is None
    assert completion.identity.subject == "ldap-new-subject"
    assert completion.identity.link_source == "reauthenticated"
    assert completion.credentials.session.auth_type == "ldap-link"


@pytest.mark.parametrize(
    ("approve", "expected_stage", "expected_identity_count"),
    [
        (True, "admin_approved", 1),
        (False, "admin_rejected", 0),
    ],
)
def test_ldap_admin_fallback_updates_bound_attempt(
    db_session,
    approve,
    expected_stage,
    expected_identity_count,
):
    user = _user(db_session, email=f"ldap-admin-{approve}@example.test")
    attempt = _ldap_attempt(db_session, user, subject=f"ldap-admin-subject-{approve}")
    service = ExternalIdentityLinkService(db_session)
    request = service.request_admin_approval(attempt.id, BROWSER_HASH)
    assert request.provider_type == "ldap"
    assert request.issuer is None
    assert service.status(attempt.id, BROWSER_HASH).stage == "admin_requested"
    superadmin = _user(
        db_session,
        email=f"ldap-admin-reviewer-{approve}@example.test",
        role=UserRole.UI_SUPERADMIN.value,
    )

    ExternalIdentityUserService(db_session).decide_link_request(
        request.id,
        superadmin=superadmin,
        approve=approve,
    )

    assert service.status(attempt.id, BROWSER_HASH).stage == expected_stage
    identities = db_session.scalars(
        select(ExternalIdentity).where(
            ExternalIdentity.user_id == user.id,
            ExternalIdentity.provider_type == "ldap",
        )
    ).all()
    assert len(identities) == expected_identity_count


def test_external_identity_uniqueness_matches_provider_semantics(db_session):
    first = _user(db_session, email="identity-one@example.test")
    second = _user(db_session, email="identity-two@example.test")
    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=first.id,
            provider_type="oidc",
            provider_id="provider-a",
            issuer=OIDC_ISSUER,
            subject="stable-subject",
            email=first.email,
            email_verified=True,
        )
    )
    db_session.commit()

    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=second.id,
            provider_type="oidc",
            provider_id="provider-b",
            issuer=OIDC_ISSUER,
            subject="stable-subject",
            email=second.email,
            email_verified=True,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=second.id,
            provider_type="oidc",
            provider_id="provider-a",
            issuer="https://other-issuer.example.test",
            subject="stable-subject",
            email=second.email,
            email_verified=True,
        )
    )
    db_session.commit()

    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=first.id,
            provider_type="ldap",
            provider_id="corp",
            subject="uid=stable,dc=example,dc=test",
            email=first.email,
            email_verified=False,
        )
    )
    db_session.commit()
    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=second.id,
            provider_type="ldap",
            provider_id="corp",
            subject="uid=stable,dc=example,dc=test",
            email=second.email,
            email_verified=False,
        )
    )
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=second.id,
            provider_type="ldap",
            provider_id="other-corp",
            subject="uid=stable,dc=example,dc=test",
            email=second.email,
            email_verified=False,
        )
    )
    db_session.commit()


def test_provision_identity_types_subject_owner_conflict(db_session):
    owner = _user(db_session, email="identity-owner@example.test")
    other = _user(db_session, email="identity-other@example.test")
    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=owner.id,
            provider_type="ldap",
            provider_id="corp",
            subject="uid=shared,dc=example,dc=test",
            email=owner.email,
            email_verified=False,
        )
    )
    db_session.commit()

    with pytest.raises(ExternalIdentityConflictError, match="belongs to another user"):
        ExternalIdentityUserService(db_session).provision_identity(
            user=other,
            provider_type="ldap",
            provider_id="corp",
            subject="uid=shared,dc=example,dc=test",
        )


def test_provision_identity_types_explicit_restore_conflict(db_session):
    user = _user(db_session, email="identity-revoked@example.test")
    db_session.add(
        ExternalIdentity(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider_type="ldap",
            provider_id="corp",
            subject="uid=revoked,dc=example,dc=test",
            email=user.email,
            email_verified=False,
            revoked_at=utcnow(),
        )
    )
    db_session.commit()

    with pytest.raises(ExternalIdentityConflictError, match="explicit restoration is required"):
        ExternalIdentityUserService(db_session).provision_identity(
            user=user,
            provider_type="ldap",
            provider_id="corp",
            subject="uid=revoked,dc=example,dc=test",
        )
