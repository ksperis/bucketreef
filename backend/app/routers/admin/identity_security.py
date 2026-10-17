# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.auth import LinkDecisionRequest
from app.models.identity_security import (
    AdminExternalIdentityInfo,
    AdminExternalIdentityRequest,
    AdminMfaResetResponse,
    AdminSessionInfo,
    AdminSetPasswordRequest,
    AdminUserSecurity,
    ExternalIdentityLinkRequestInfo,
)
from app.models.user import UserUpdate, validate_password_policy
from app.routers.dependencies import (
    get_audit_service,
    get_current_super_admin,
    get_users_service_dependency,
)
from app.services.admin_identity_security_service import AdminIdentitySecurityService
from app.services.audit_service import AuditService
from app.services.auth_session_service import AuthSessionService
from app.services.external_identity_user_service import ExternalIdentityUserService
from app.services.identity_security_policy import (
    passkey_required_for_role,
    require_admin_interactive_session,
    require_admin_sensitive_action,
)
from app.services.mfa_reset_service import MfaResetService
from app.services.users_service import UsersService
from app.utils.http_errors import (
    raise_bad_request_from_value_error,
    raise_http_error_from_value_error,
    raise_http_exception_from_exception,
)


router = APIRouter(prefix="/admin", tags=["admin-identity-security"])


@router.get("/users/{user_id}/security", response_model=AdminUserSecurity)
def get_user_security(
    request: Request,
    user_id: int,
    include_revoked: bool = Query(True),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
) -> AdminUserSecurity:
    require_admin_interactive_session(request, db, actor)
    return AdminIdentitySecurityService(db).user_security(
        actor,
        user_id,
        include_revoked=include_revoked,
    )


@router.post("/users/{user_id}/mfa/reset", response_model=AdminMfaResetResponse)
def reset_user_mfa(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> AdminMfaResetResponse:
    require_admin_sensitive_action(request, db, actor)
    target = AdminIdentitySecurityService(db).managed_user(
        actor,
        user_id,
        allow_self=False,
    )
    result = MfaResetService(db).reset(target, reason="administrator_mfa_reset")
    enrollment_required = passkey_required_for_role(db, target.role)
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_reset_user_mfa",
        entity_type="ui_user",
        entity_id=str(target.id),
        metadata={
            "passkey_enrollment_required": enrollment_required,
            "passkeys_removed": result.passkeys_removed,
            "recovery_codes_removed": result.recovery_codes_removed,
            "challenges_removed": result.challenges_removed,
        },
    )
    return AdminMfaResetResponse(
        user_id=target.id,
        passkey_enrollment_required=enrollment_required,
        passkeys_removed=result.passkeys_removed,
        recovery_codes_removed=result.recovery_codes_removed,
        challenges_removed=result.challenges_removed,
    )


@router.put("/users/{user_id}/security/password", status_code=status.HTTP_204_NO_CONTENT)
def set_user_password(
    request: Request,
    user_id: int,
    payload: AdminSetPasswordRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    users: UsersService = Depends(get_users_service_dependency),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_sensitive_action(request, db, actor)
    target = AdminIdentitySecurityService(db).managed_user(
        actor,
        user_id,
        allow_self=False,
    )
    try:
        validate_password_policy(payload.password)
        users.update_user(target.id, UserUpdate(password=payload.password))
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_set_local_password",
        entity_type="ui_user",
        entity_id=str(target.id),
        metadata={"sessions_revoked": True},
    )


@router.post(
    "/users/{user_id}/external-identities",
    response_model=AdminExternalIdentityInfo,
    status_code=status.HTTP_201_CREATED,
)
def add_user_external_identity(
    request: Request,
    user_id: int,
    payload: AdminExternalIdentityRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> AdminExternalIdentityInfo:
    require_admin_sensitive_action(request, db, actor)
    security = AdminIdentitySecurityService(db)
    target = security.managed_user(actor, user_id, allow_self=False)
    try:
        identity, changed = ExternalIdentityUserService(db).provision_identity(
            user=target,
            provider_type=payload.provider_type,
            provider_id=payload.provider_id,
            subject=payload.subject,
            email=str(payload.email) if payload.email else None,
            email_verified=payload.email_verified,
            restore=payload.restore,
            link_source="administrator",
        )
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_external_identity_linked" if changed else "administrator_external_identity_unchanged",
        entity_type="external_identity",
        entity_id=identity.id,
        metadata={"provider_type": identity.provider_type, "provider_id": identity.provider_id},
    )
    return security.external_identity_info(identity)


@router.delete("/users/{user_id}/external-identities/{identity_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_user_external_identity(
    request: Request,
    user_id: int,
    identity_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_sensitive_action(request, db, actor)
    _, identity = AdminIdentitySecurityService(db).managed_identity(
        actor,
        user_id,
        identity_id,
    )
    try:
        ExternalIdentityUserService(db).revoke_identity(identity.id, reason="administrator_identity_revoked")
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_external_identity_revoked",
        entity_type="external_identity",
        entity_id=identity.id,
        metadata={"provider_type": identity.provider_type, "provider_id": identity.provider_id},
    )


@router.post("/users/{user_id}/external-identities/{identity_id}/restore", response_model=AdminExternalIdentityInfo)
def restore_user_external_identity(
    request: Request,
    user_id: int,
    identity_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> AdminExternalIdentityInfo:
    require_admin_sensitive_action(request, db, actor)
    security = AdminIdentitySecurityService(db)
    _, identity = security.managed_identity(actor, user_id, identity_id)
    try:
        restored = ExternalIdentityUserService(db).restore_identity(identity.id)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_external_identity_restored",
        entity_type="external_identity",
        entity_id=restored.id,
        metadata={"provider_type": restored.provider_type, "provider_id": restored.provider_id},
    )
    return security.external_identity_info(restored)


@router.delete("/users/{user_id}/security/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_user_session(
    request: Request,
    user_id: int,
    session_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_interactive_session(request, db, actor)
    session = AdminIdentitySecurityService(db).managed_user_session(
        actor,
        user_id,
        session_id,
    )
    AuthSessionService(db).revoke_session(session.id, "administrator_revoked")
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_revoke_session",
        entity_type="auth_session",
        entity_id=session.id,
    )


@router.get("/identity/link-requests", response_model=list[ExternalIdentityLinkRequestInfo])
def list_identity_link_requests(
    request: Request,
    include_decided: bool = Query(False),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
) -> list[ExternalIdentityLinkRequestInfo]:
    require_admin_interactive_session(request, db, actor)
    return AdminIdentitySecurityService(db).list_link_requests(
        actor,
        include_decided=include_decided,
    )


@router.post("/identity/link-requests/{request_id}")
def decide_identity_link_request(
    request: Request,
    request_id: str,
    payload: LinkDecisionRequest,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    require_admin_interactive_session(request, db, actor)
    AdminIdentitySecurityService(db).managed_link_request(actor, request_id)
    if payload.approve:
        require_admin_sensitive_action(request, db, actor)
    try:
        decided = ExternalIdentityUserService(db).decide_link_request(
            request_id,
            superadmin=actor,
            approve=payload.approve,
            reason=payload.reason,
        )
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    audit.record_action(
        user=actor,
        scope="security",
        action="external_identity_link_decision",
        entity_type="external_identity_link_request",
        entity_id=decided.id,
        metadata={
            "decision": decided.status,
            "provider_type": decided.provider_type,
            "provider_id": decided.provider_id,
        },
    )
    return {"id": decided.id, "status": decided.status}


@router.get("/identity/sessions", response_model=list[AdminSessionInfo])
def list_global_sessions(
    request: Request,
    include_revoked: bool = Query(False),
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
) -> list[AdminSessionInfo]:
    require_admin_interactive_session(request, db, actor)
    return AdminIdentitySecurityService(db).list_global_sessions(
        actor,
        include_revoked=include_revoked,
    )


@router.delete("/identity/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_global_session(
    request: Request,
    session_id: str,
    db: Session = Depends(get_db),
    actor: User = Depends(get_current_super_admin),
    audit: AuditService = Depends(get_audit_service),
) -> None:
    require_admin_interactive_session(request, db, actor)
    row = AdminIdentitySecurityService(db).managed_global_session(actor, session_id)
    AuthSessionService(db).revoke_session(row.id, "administrator_revoked")
    audit.record_action(
        user=actor,
        scope="security",
        action="administrator_revoke_session",
        entity_type="auth_session",
        entity_id=row.id,
    )
