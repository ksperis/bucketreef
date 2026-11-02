# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.sensitive_data import sanitize_error_detail
from app.db import User
from app.models.auth import RecoveryCodeRequest, WebAuthnAuthenticationRequest, WebAuthnCredentialRequest
from app.models.oidc import OIDCStartResponse
from app.models.external_identity_link import (
    ExternalIdentityLinkLdapProof,
    ExternalIdentityLinkMfaRegistrationResult,
    ExternalIdentityLinkPasswordProof,
    ExternalIdentityProfileOidcStartRequest,
    ExternalIdentityLinkStatus,
)
from app.routers.auth_common import AuthAttemptContext
from app.routers.auth_cookies import (
    ensure_external_identity_browser_binding,
    external_identity_browser_binding_hash,
    set_auth_cookies,
)
from app.routers.auth_request_context import request_context
from app.routers.dependencies import get_audit_service, get_current_user
from app.services.audit_service import AuditService
from app.services.app_settings_service import load_app_settings_for_db
from app.services.auth_session_guards import current_auth_session
from app.services.identity_security_policy import require_self_service_security_action
from app.services.ldap_service import LDAPAuthenticationError, LDAPConfigurationError, LDAPProviderNotFoundError
from app.services.external_identity_link_contracts import ExternalIdentityLinkError
from app.services.external_identity_link_service import ExternalIdentityLinkService
from app.services.oidc_service import (
    OIDCConfigurationError,
    OIDCProviderNotFoundError,
    OidcService,
    get_oidc_service,
)
from app.services.webauthn_service import WebAuthnSecurityError, WebAuthnService
from app.utils.request_security import require_trusted_origin


router = APIRouter()
settings = get_settings()


def _link_service(db: Session) -> ExternalIdentityLinkService:
    return ExternalIdentityLinkService(db)


def _link_error(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=400,
        detail=sanitize_error_detail(str(exc) or "External identity account linking failed"),
    )


@router.get("/identity/link/{attempt_id}", response_model=ExternalIdentityLinkStatus)
def external_identity_link_status(
    request: Request,
    attempt_id: str,
    db: Session = Depends(get_db),
) -> ExternalIdentityLinkStatus:
    try:
        return _link_service(db).status(attempt_id, external_identity_browser_binding_hash(request))
    except ExternalIdentityLinkError as exc:
        raise _link_error(exc) from exc


@router.post("/identity/link/{attempt_id}/proof/password", response_model=ExternalIdentityLinkStatus)
def external_identity_link_password_proof(
    request: Request,
    attempt_id: str,
    payload: ExternalIdentityLinkPasswordProof,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_service),
) -> ExternalIdentityLinkStatus:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        user = service.target_user(attempt_id, browser_hash)
    except ExternalIdentityLinkError as exc:
        raise _link_error(exc) from exc
    proof_attempt = AuthAttemptContext.from_request(
        request=request,
        db=db,
        audit_service=audit_service,
        account_key=f"external-identity-link-proof:{attempt_id}",
    )
    proof_attempt.check_rate_limit(
        user_email=user.email,
        user_role=user.role,
        scope="security",
        action="external_identity_account_proof",
        entity_type="external_identity_link_attempt",
        audit_message="External identity link account proof was rate limited",
        public_detail="Too many account verification attempts",
        metadata={"attempt_id": attempt_id, "method": "password"},
    )
    try:
        result = service.verify_password(
            attempt_id,
            browser_hash,
            payload.password,
        )
    except ExternalIdentityLinkError as exc:
        proof_attempt.limiter.record_failure(account=proof_attempt.account_key, ip_address=proof_attempt.ip_address)
        proof_attempt.audit(
            user=user,
            scope="security",
            action="external_identity_account_proof",
            entity_type="external_identity_link_attempt",
            entity_id=attempt_id,
            status_value="failure",
            message="External identity link account proof failed",
            metadata={"method": "password"},
        )
        raise HTTPException(status_code=400, detail="Account proof failed") from exc
    proof_attempt.clear_rate_limit()
    proof_attempt.audit(
        user=user,
        scope="security",
        action="external_identity_account_proof",
        entity_type="external_identity_link_attempt",
        entity_id=attempt_id,
        metadata={"method": "password"},
    )
    return result


@router.post("/identity/link/{attempt_id}/proof/ldap", response_model=ExternalIdentityLinkStatus)
def external_identity_link_ldap_proof(
    request: Request,
    attempt_id: str,
    payload: ExternalIdentityLinkLdapProof,
    db: Session = Depends(get_db),
    audit_service: AuditService = Depends(get_audit_service),
) -> ExternalIdentityLinkStatus:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        user = service.target_user(attempt_id, browser_hash)
    except ExternalIdentityLinkError as exc:
        raise _link_error(exc) from exc
    proof_attempt = AuthAttemptContext.from_request(
        request=request,
        db=db,
        audit_service=audit_service,
        account_key=f"external-identity-link-proof:{attempt_id}",
    )
    proof_attempt.check_rate_limit(
        user_email=user.email,
        user_role=user.role,
        scope="security",
        action="external_identity_account_proof",
        entity_type="external_identity_link_attempt",
        audit_message="External identity link account proof was rate limited",
        public_detail="Too many account verification attempts",
        metadata={"attempt_id": attempt_id, "method": "ldap", "provider_id": payload.provider_id},
    )
    try:
        result = service.verify_ldap(
            attempt_id,
            browser_hash,
            provider_id=payload.provider_id,
            username=payload.username,
            password=payload.password,
        )
    except (ExternalIdentityLinkError, LDAPAuthenticationError, LDAPConfigurationError, LDAPProviderNotFoundError) as exc:
        proof_attempt.limiter.record_failure(account=proof_attempt.account_key, ip_address=proof_attempt.ip_address)
        proof_attempt.audit(
            user=user,
            scope="security",
            action="external_identity_account_proof",
            entity_type="external_identity_link_attempt",
            entity_id=attempt_id,
            status_value="failure",
            message="External identity link account proof failed",
            metadata={"method": "ldap", "provider_id": payload.provider_id},
        )
        raise HTTPException(status_code=400, detail="LDAP account proof failed") from exc
    proof_attempt.clear_rate_limit()
    proof_attempt.audit(
        user=user,
        scope="security",
        action="external_identity_account_proof",
        entity_type="external_identity_link_attempt",
        entity_id=attempt_id,
        metadata={"method": "ldap", "provider_id": payload.provider_id},
    )
    return result


@router.post(
    "/identity/link/{attempt_id}/proof/oidc/{provider_id}/start",
    response_model=OIDCStartResponse,
)
def external_identity_link_oidc_proof_start(
    request: Request,
    attempt_id: str,
    provider_id: str,
    db: Session = Depends(get_db),
) -> OIDCStartResponse:
    request_origin = require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        proof_identity = service.proof_oidc_identity(attempt_id, browser_hash, provider_id)
        oidc = get_oidc_service(db)
        issuer = oidc.provider_issuer(provider_id)
        if issuer != proof_identity.issuer:
            raise ExternalIdentityLinkError("OIDC proof provider issuer does not match the linked identity")
        result = oidc.start_login(
            provider_id,
            None,
            request_origin=request_origin,
            browser_secret_hash=browser_hash,
            purpose="link_proof",
            target_user_id=proof_identity.user_id,
            link_attempt_id=attempt_id,
            require_auth_time=True,
        )
        return OIDCStartResponse.model_validate(result)
    except (ExternalIdentityLinkError, OIDCProviderNotFoundError, OIDCConfigurationError) as exc:
        raise _link_error(exc) from exc


@router.post("/identity/link/{attempt_id}/webauthn/authentication/options")
def external_identity_link_webauthn_authentication_options(
    request: Request,
    attempt_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        status = service.status(attempt_id, browser_hash)
        if status.stage != "mfa":
            raise ExternalIdentityLinkError("Passkey authentication is not required")
        user = service.target_user(attempt_id, browser_hash)
        return WebAuthnService(db).begin_authentication(user, binding_sid=f"external-identity-link:{attempt_id}")
    except (ExternalIdentityLinkError, WebAuthnSecurityError) as exc:
        raise _link_error(exc) from exc


@router.post("/identity/link/{attempt_id}/webauthn/authentication/verify", response_model=ExternalIdentityLinkStatus)
def external_identity_link_webauthn_authentication_verify(
    request: Request,
    attempt_id: str,
    payload: WebAuthnAuthenticationRequest,
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> ExternalIdentityLinkStatus:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        user = service.target_user(attempt_id, browser_hash)
        WebAuthnService(db).finish_authentication(
            user,
            credential=payload.credential,
            binding_sid=f"external-identity-link:{attempt_id}",
        )
        status_model = service.mark_mfa_verified(attempt_id, browser_hash)
    except (ExternalIdentityLinkError, WebAuthnSecurityError) as exc:
        raise _link_error(exc) from exc
    ip_address, user_agent, request_id = request_context(request, settings=settings)
    audit.record_action(
        user=user,
        scope="security",
        action="webauthn_step_up_success",
        entity_type="external_identity_link_attempt",
        entity_id=attempt_id,
        metadata={"context": "external_identity_link"},
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return status_model


@router.post("/identity/link/{attempt_id}/recovery/verify", response_model=ExternalIdentityLinkStatus)
def external_identity_link_recovery_code_verify(
    request: Request,
    attempt_id: str,
    payload: RecoveryCodeRequest,
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> ExternalIdentityLinkStatus:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        status_model = service.status(attempt_id, browser_hash)
        if status_model.stage != "mfa":
            raise ExternalIdentityLinkError("Recovery code verification is not required")
        user = service.target_user(attempt_id, browser_hash)
        if not WebAuthnService(db).consume_recovery_code(user, payload.code):
            raise ExternalIdentityLinkError("Invalid recovery code")
        status_model = service.mark_mfa_verified(attempt_id, browser_hash)
    except ExternalIdentityLinkError as exc:
        raise _link_error(exc) from exc
    ip_address, user_agent, request_id = request_context(request, settings=settings)
    audit.record_action(
        user=user,
        scope="auth",
        action="recovery_code_authentication_success",
        entity_type="external_identity_link_attempt",
        entity_id=attempt_id,
        metadata={"context": "external_identity_link"},
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return status_model


@router.post("/identity/link/{attempt_id}/webauthn/registration/options")
def external_identity_link_webauthn_registration_options(
    request: Request,
    attempt_id: str,
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        status = service.status(attempt_id, browser_hash)
        if status.stage != "mfa_enrollment":
            raise ExternalIdentityLinkError("Passkey enrollment is not required")
        user = service.target_user(attempt_id, browser_hash)
        return WebAuthnService(db).begin_registration(user, binding_sid=f"external-identity-link:{attempt_id}")
    except (ExternalIdentityLinkError, WebAuthnSecurityError) as exc:
        raise _link_error(exc) from exc


@router.post(
    "/identity/link/{attempt_id}/webauthn/registration/verify",
    response_model=ExternalIdentityLinkMfaRegistrationResult,
)
def external_identity_link_webauthn_registration_verify(
    request: Request,
    attempt_id: str,
    payload: WebAuthnCredentialRequest,
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> ExternalIdentityLinkMfaRegistrationResult:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        user = service.target_user(attempt_id, browser_hash)
        webauthn = WebAuthnService(db)
        credential_row = webauthn.finish_registration(
            user,
            credential=payload.credential,
            name=payload.name,
            binding_sid=f"external-identity-link:{attempt_id}",
        )
        recovery_codes = webauthn.issue_recovery_codes(user)
        status = service.mark_mfa_verified(attempt_id, browser_hash)
    except (ExternalIdentityLinkError, WebAuthnSecurityError) as exc:
        raise _link_error(exc) from exc
    ip_address, user_agent, request_id = request_context(request, settings=settings)
    audit.record_action(
        user=user,
        scope="security",
        action="webauthn_enrollment_completed",
        entity_type="webauthn_credential",
        entity_id=credential_row.id,
        metadata={
            "context": "external_identity_link",
            "attempt_id": attempt_id,
            "recovery_codes_issued": len(recovery_codes),
        },
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return ExternalIdentityLinkMfaRegistrationResult(status=status, recovery_codes=recovery_codes)


@router.post("/identity/link/{attempt_id}/request-admin", response_model=ExternalIdentityLinkStatus)
def external_identity_link_request_admin(
    request: Request,
    attempt_id: str,
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> ExternalIdentityLinkStatus:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    service = _link_service(db)
    try:
        user = service.target_user(attempt_id, browser_hash)
        link_request = service.request_admin_approval(attempt_id, browser_hash)
        status_model = service.status(attempt_id, browser_hash)
    except ExternalIdentityLinkError as exc:
        raise _link_error(exc) from exc
    ip_address, user_agent, request_id = request_context(request, settings=settings)
    audit.record_action(
        user=user,
        scope="security",
        action="external_identity_admin_approval_requested",
        entity_type="external_identity_link_request",
        entity_id=link_request.id,
        metadata={"provider_type": status_model.provider_type, "provider_id": status_model.provider_id},
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return status_model


@router.post("/identity/link/{attempt_id}/confirm", response_model=ExternalIdentityLinkStatus)
def external_identity_link_confirm(
    request: Request,
    response: Response,
    attempt_id: str,
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> ExternalIdentityLinkStatus:
    require_trusted_origin(request)
    browser_hash = external_identity_browser_binding_hash(request)
    ip_address, user_agent, request_id = request_context(request, settings=settings)
    service = _link_service(db)
    try:
        completed = service.confirm(
            attempt_id,
            browser_hash,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        set_auth_cookies(response, completed.credentials)
        status_model = service.status(attempt_id, browser_hash)
    except ExternalIdentityLinkError as exc:
        raise _link_error(exc) from exc
    audit.record_action(
        user=completed.user,
        scope="security",
        action="external_identity_reauthenticated_linked",
        entity_type="external_identity",
        entity_id=completed.identity.id,
        metadata={
            "provider_type": completed.identity.provider_type,
            "provider_id": completed.identity.provider_id,
        },
        ip_address=ip_address,
        user_agent=user_agent,
        request_id=request_id,
    )
    return status_model


@router.post("/security/oidc/{provider_id}/start-link", response_model=OIDCStartResponse)
def profile_oidc_link_start(
    request: Request,
    response: Response,
    provider_id: str,
    payload: ExternalIdentityProfileOidcStartRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OIDCStartResponse:
    if not load_app_settings_for_db(db).general.allow_user_external_identity_link:
        raise HTTPException(
            status_code=403,
            detail="External identity linking is disabled by the application administrator",
        )
    request_origin = require_trusted_origin(request)
    require_self_service_security_action(request, db, current_user)
    current_session = current_auth_session(request, db)
    _, browser_hash = ensure_external_identity_browser_binding(request, response)
    oidc = get_oidc_service(db)
    try:
        issuer = oidc.provider_issuer(provider_id)
        attempt = _link_service(db).create_profile_attempt(
            user=current_user,
            provider_id=provider_id,
            issuer=issuer,
            browser_secret_hash=browser_hash,
            auth_session_id=current_session.id,
            mfa_verified_at=current_session.mfa_verified_at,
            redirect_path=payload.redirect_path if payload else None,
        )
        result = oidc.start_login(
            provider_id,
            None,
            request_origin=request_origin,
            browser_secret_hash=browser_hash,
            purpose="link_identity",
            target_user_id=current_user.id,
            link_attempt_id=attempt.id,
            auth_session_id=current_session.id,
        )
        return OIDCStartResponse.model_validate(result)
    except (ExternalIdentityLinkError, OIDCProviderNotFoundError, OIDCConfigurationError) as exc:
        raise _link_error(exc) from exc
