# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.api_token import ApiTokenCreateResponse, ApiTokenInfo
from app.models.auth import (
    AuthenticationResponse,
    CurrentSessionResponse,
    ExternalIdentityInfo,
    RefreshResponse,
    SessionInfo,
    WebAuthnCredentialCreatedResponse,
    WebAuthnCredentialInfo,
)
from app.models.identity_security import (
    AdminExternalIdentityInfo,
    AdminPasskeyInfo,
    AdminSessionInfo,
    AdminUserSecurity,
    ExternalIdentityLinkRequestInfo,
)


def test_api_token_responses_require_complete_canonical_payloads() -> None:
    assert set(ApiTokenInfo.model_json_schema()["required"]) == {
        "id",
        "name",
        "created_at",
        "last_used_at",
        "expires_at",
        "revoked_at",
        "scopes",
    }
    assert set(ApiTokenCreateResponse.model_json_schema()["required"]) == {
        "access_token",
        "token_type",
        "api_token",
    }


def test_refresh_response_requires_explicit_status() -> None:
    assert set(RefreshResponse.model_json_schema()["required"]) == {"status"}


def test_authentication_responses_require_complete_canonical_payloads() -> None:
    assert set(AuthenticationResponse.model_json_schema()["required"]) == {
        "status",
        "user",
        "session",
        "redirect_path",
        "link_request_id",
        "recovery_codes",
    }
    assert set(SessionInfo.model_json_schema()["required"]) == {
        "id",
        "principal_type",
        "auth_type",
        "created_at",
        "last_activity_at",
        "idle_expires_at",
        "absolute_expires_at",
        "mfa_verified_at",
        "ip_address",
        "user_agent",
        "revoked_at",
        "revoke_reason",
        "current",
        "user_id",
        "s3_session_id",
    }
    assert set(CurrentSessionResponse.model_json_schema()["required"]) == {
        "authenticated",
        "user",
        "session",
        "auth_session",
    }
    assert set(WebAuthnCredentialInfo.model_json_schema()["required"]) == {
        "id",
        "name",
        "created_at",
        "last_used_at",
    }
    assert set(WebAuthnCredentialCreatedResponse.model_json_schema()["required"]) == {
        "id",
        "name",
        "reauthentication_required",
    }
    assert set(ExternalIdentityInfo.model_json_schema()["required"]) == {
        "id",
        "provider_type",
        "provider_id",
        "email",
        "email_verified",
        "created_at",
        "last_login_at",
    }


def test_admin_identity_responses_require_complete_canonical_payloads() -> None:
    assert set(AdminPasskeyInfo.model_json_schema()["required"]) == {
        "id",
        "name",
        "created_at",
        "last_used_at",
        "revoked_at",
    }
    assert set(AdminSessionInfo.model_json_schema()["required"]) == {
        *SessionInfo.model_json_schema()["required"],
        "user_email",
        "user_full_name",
        "user_role",
    }
    assert set(AdminExternalIdentityInfo.model_json_schema()["required"]) == {
        "id",
        "provider_type",
        "provider_id",
        "subject",
        "email",
        "email_verified",
        "link_source",
        "created_at",
        "last_login_at",
        "revoked_at",
    }
    assert set(AdminUserSecurity.model_json_schema()["required"]) == {
        "user_id",
        "email",
        "role",
        "has_local_password",
        "passkey_required",
        "passkeys",
        "external_identities",
        "sessions",
    }
    assert set(ExternalIdentityLinkRequestInfo.model_json_schema()["required"]) == {
        "id",
        "user_id",
        "user_email",
        "user_role",
        "provider_type",
        "provider_id",
        "email",
        "status",
        "created_at",
        "expires_at",
        "decided_at",
        "decision_source",
    }
