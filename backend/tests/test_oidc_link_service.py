# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.security import get_password_hash
from app.db import ExternalIdentity, OidcLinkAttempt, User, UserNotification, UserRole
from app.services.api_token_service import ApiTokenService
from app.services.auth_session_service import AuthSessionService
from app.services.ldap_service import LDAPIdentity
from app.services.oidc_link_service import OidcLinkError, OidcLinkService
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


def _attempt(db_session, user: User, *, subject: str = "new-subject") -> OidcLinkAttempt:
    return OidcLinkService(db_session).create_login_collision_attempt(
        user=user,
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


def test_link_attempt_is_browser_bound_and_expires(db_session):
    user = _user(db_session, email="browser-bound@example.test")
    attempt = _attempt(db_session, user)
    service = OidcLinkService(db_session)

    with pytest.raises(OidcLinkError, match="browser binding mismatch"):
        service.status(attempt.id, "wrong-browser")

    attempt.expires_at = utcnow() - timedelta(seconds=1)
    db_session.add(attempt)
    db_session.commit()
    with pytest.raises(OidcLinkError, match="expired"):
        service.status(attempt.id, BROWSER_HASH)


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
    service = OidcLinkService(db_session)

    password_attempt = _attempt(db_session, user, subject="password-target")
    with pytest.raises(OidcLinkError, match="Invalid account password"):
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

    monkeypatch.setattr("app.services.oidc_link_service.LDAPAuthService", FakeLdapService)
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
    service = OidcLinkService(db_session)

    request = service.request_admin_approval(attempt.id, BROWSER_HASH)

    assert request.user_id == user.id
    assert request.provider_type == "oidc"
    assert request.issuer == OIDC_ISSUER
    assert request.subject == "new-subject"
    assert service.status(attempt.id, BROWSER_HASH).stage == "admin_requested"


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

    completion = OidcLinkService(db_session).confirm(
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


def test_legacy_oidc_identity_is_revalidated_in_place(db_session):
    user = _user(db_session, email="legacy@example.test")
    legacy = ExternalIdentity(
        id=str(uuid.uuid4()),
        user_id=user.id,
        provider_type="oidc",
        provider_id="company",
        issuer=None,
        subject="legacy-subject",
        email=user.email,
        email_verified=True,
        revalidation_required=True,
    )
    db_session.add(legacy)
    db_session.commit()
    attempt = _attempt(db_session, user, subject="legacy-subject")
    assert attempt.existing_identity_id == legacy.id

    service = OidcLinkService(db_session)
    service.verify_password(attempt.id, BROWSER_HASH, "correct horse battery staple")
    completion = service.confirm(
        attempt.id,
        BROWSER_HASH,
        ip_address="127.0.0.1",
        user_agent="pytest",
    )

    assert completion.identity.id == legacy.id
    assert completion.identity.issuer == OIDC_ISSUER
    assert completion.identity.revalidation_required is False
    assert completion.identity.link_source == "revalidated"


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
