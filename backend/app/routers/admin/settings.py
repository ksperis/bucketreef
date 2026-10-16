# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.app_settings import AppSettings, GeneralFeatureLocks, QuotaNotificationSettings
from app.models.ldap import LDAP_PROVIDER_CONFIG_FIELDS, LDAPProviderAdminItem, LDAPProviderAdminPayload
from app.models.oidc import OIDC_PROVIDER_CONFIG_FIELDS, OIDCProviderAdminItem, OIDCProviderAdminPayload
from app.routers.dependencies import get_audit_service, get_current_ui_superadmin
from app.utils.http_errors import (
    raise_bad_gateway_from_runtime,
    raise_http_exception_from_exception,
    raise_http_error_from_value_error,
)
from app.services.audit_service import AuditService
from app.services.app_settings_service import (
    get_general_feature_locks,
    load_app_settings,
    load_app_settings_for_db,
    load_default_app_settings,
    save_app_settings,
)
from app.services.identity_security_policy import require_admin_sensitive_action
from app.services.healthcheck_background_service import run_initial_healthchecks
from app.services.identity_provider_repository import (
    IdentityProviderAlreadyExistsError,
    IdentityProviderManagedByEnvironmentError,
    IdentityProviderNotFoundError,
)
from app.services.ldap_provider_settings_service import (
    create_ldap_provider,
    delete_ldap_provider,
    list_effective_ldap_providers,
    update_ldap_provider,
)
from app.services.oidc_provider_settings_service import (
    create_oidc_provider,
    delete_oidc_provider,
    list_effective_oidc_providers,
    update_oidc_provider,
)
from app.services.quota_alert_email_service import QuotaAlertEmailService
from app.services.portal_service import get_portal_service

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])

_SENSITIVE_GENERAL_SETTINGS = (
    "ceph_admin_enabled",
    "allow_login_access_keys",
    "allow_login_endpoint_list",
    "allow_login_custom_endpoint",
    "require_passkey_for_admins",
    "require_passkey_for_users",
    "allow_user_external_identity_unlink",
)


def _authentication_settings_changed(current: AppSettings, requested: AppSettings) -> bool:
    return any(
        getattr(current.general, field) != getattr(requested.general, field)
        for field in _SENSITIVE_GENERAL_SETTINGS
    )


def _portal_server_access_logging_changed(current: AppSettings, requested: AppSettings) -> bool:
    return (
        current.portal.feature_policies.server_access_logging
        != requested.portal.feature_policies.server_access_logging
    )


@router.get("", response_model=AppSettings)
def get_settings(_: User = Depends(get_current_ui_superadmin)) -> AppSettings:
    return load_app_settings()


@router.get("/defaults", response_model=AppSettings)
def get_default_settings(_: User = Depends(get_current_ui_superadmin)) -> AppSettings:
    return load_default_app_settings()


@router.get("/general-feature-locks", response_model=GeneralFeatureLocks)
def get_general_feature_locks_route(_: User = Depends(get_current_ui_superadmin)) -> GeneralFeatureLocks:
    return get_general_feature_locks()


@router.put("", response_model=AppSettings)
def update_settings(
    request: Request,
    payload: AppSettings,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> AppSettings:
    current_settings = load_app_settings_for_db(db)
    if _authentication_settings_changed(current_settings, payload):
        require_admin_sensitive_action(request, db, current_user)
    server_access_logging_summary = {"accounts": 0, "enabled": 0, "disabled": 0, "skipped": 0}
    if _portal_server_access_logging_changed(current_settings, payload):
        try:
            server_access_logging_summary = get_portal_service(db).reconcile_all_portal_server_access_logging(payload.portal)
        except RuntimeError as exc:
            raise_bad_gateway_from_runtime(exc)
    saved = save_app_settings(payload)
    audit.record_action(
        user=current_user,
        scope="admin",
        action="settings.update",
        entity_type="app_settings",
        entity_id="global",
        metadata={
            "sections": sorted(saved.model_dump().keys()),
            "feature_policies": {section: {"before": getattr(current_settings, section).feature_policies.model_dump(mode="json"),
                                          "after": getattr(saved, section).feature_policies.model_dump(mode="json")}
                                 for section in ("manager", "portal")},
            "portal_server_access_logging": server_access_logging_summary,
        },
    )
    if saved.general.endpoint_status_enabled and not current_settings.general.endpoint_status_enabled:
        background_tasks.add_task(run_initial_healthchecks)
    return saved


@router.get("/oidc/providers", response_model=list[OIDCProviderAdminItem])
def list_oidc_provider_settings(
    _: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> list[OIDCProviderAdminItem]:
    return list_effective_oidc_providers(db)


@router.post("/oidc/providers", response_model=OIDCProviderAdminItem, status_code=status.HTTP_201_CREATED)
def create_oidc_provider_settings(
    request: Request,
    payload: OIDCProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> OIDCProviderAdminItem:
    require_admin_sensitive_action(request, db, current_user)
    try:
        item = create_oidc_provider(db, payload)
    except IdentityProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except IdentityProviderAlreadyExistsError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="oidc_provider.create",
        entity_type="oidc_provider",
        entity_id=item.provider_id,
        metadata=_provider_audit_metadata(
            payload,
            fields=OIDC_PROVIDER_CONFIG_FIELDS,
            secret_action_field="client_secret_action",
            secret_action="set" if payload.client_secret else "none",
        ),
    )
    return item


@router.put("/oidc/providers/{provider_id}", response_model=OIDCProviderAdminItem)
def update_oidc_provider_settings(
    request: Request,
    provider_id: str,
    payload: OIDCProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> OIDCProviderAdminItem:
    require_admin_sensitive_action(request, db, current_user)
    try:
        item = update_oidc_provider(db, provider_id, payload)
    except IdentityProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except IdentityProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="oidc_provider.update",
        entity_type="oidc_provider",
        entity_id=item.provider_id,
        metadata=_provider_audit_metadata(
            payload,
            fields=OIDC_PROVIDER_CONFIG_FIELDS,
            secret_action_field="client_secret_action",
            secret_action=_secret_update_action(
                secret=payload.client_secret,
                clear=payload.clear_client_secret,
            ),
        ),
    )
    return item


@router.delete("/oidc/providers/{provider_id}")
def delete_oidc_provider_settings(
    request: Request,
    provider_id: str,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    require_admin_sensitive_action(request, db, current_user)
    try:
        delete_oidc_provider(db, provider_id)
    except IdentityProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except IdentityProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="oidc_provider.delete",
        entity_type="oidc_provider",
        entity_id=provider_id.lower(),
        metadata={"provider_id": provider_id.lower()},
    )
    return {"status": "deleted"}


@router.get("/ldap/providers", response_model=list[LDAPProviderAdminItem])
def list_ldap_provider_settings(
    _: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
) -> list[LDAPProviderAdminItem]:
    return list_effective_ldap_providers(db)


@router.post("/ldap/providers", response_model=LDAPProviderAdminItem, status_code=status.HTTP_201_CREATED)
def create_ldap_provider_settings(
    request: Request,
    payload: LDAPProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> LDAPProviderAdminItem:
    require_admin_sensitive_action(request, db, current_user)
    try:
        item = create_ldap_provider(db, payload)
    except IdentityProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except IdentityProviderAlreadyExistsError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="ldap_provider.create",
        entity_type="ldap_provider",
        entity_id=item.provider_id,
        metadata=_provider_audit_metadata(
            payload,
            fields=LDAP_PROVIDER_CONFIG_FIELDS,
            secret_action_field="bind_password_action",
            secret_action="set" if payload.bind_password else "none",
        ),
    )
    return item


@router.put("/ldap/providers/{provider_id}", response_model=LDAPProviderAdminItem)
def update_ldap_provider_settings(
    request: Request,
    provider_id: str,
    payload: LDAPProviderAdminPayload,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> LDAPProviderAdminItem:
    require_admin_sensitive_action(request, db, current_user)
    try:
        item = update_ldap_provider(db, provider_id, payload)
    except IdentityProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except IdentityProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="ldap_provider.update",
        entity_type="ldap_provider",
        entity_id=item.provider_id,
        metadata=_provider_audit_metadata(
            payload,
            fields=LDAP_PROVIDER_CONFIG_FIELDS,
            secret_action_field="bind_password_action",
            secret_action=_secret_update_action(
                secret=payload.bind_password,
                clear=payload.clear_bind_password or payload.bind_dn is None,
            ),
        ),
    )
    return item


@router.delete("/ldap/providers/{provider_id}")
def delete_ldap_provider_settings(
    request: Request,
    provider_id: str,
    current_user: User = Depends(get_current_ui_superadmin),
    db: Session = Depends(get_db),
    audit: AuditService = Depends(get_audit_service),
) -> dict[str, str]:
    require_admin_sensitive_action(request, db, current_user)
    try:
        delete_ldap_provider(db, provider_id)
    except IdentityProviderManagedByEnvironmentError as exc:
        raise_http_exception_from_exception(status.HTTP_409_CONFLICT, exc)
    except IdentityProviderNotFoundError as exc:
        raise_http_exception_from_exception(status.HTTP_404_NOT_FOUND, exc)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)

    audit.record_action(
        user=current_user,
        scope="admin",
        action="ldap_provider.delete",
        entity_type="ldap_provider",
        entity_id=provider_id.lower(),
        metadata={"provider_id": provider_id.lower()},
    )
    return {"status": "deleted"}


@router.post("/quota-notifications/test-email")
def send_quota_notifications_test_email(
    payload: QuotaNotificationSettings,
    current_user: User = Depends(get_current_ui_superadmin),
) -> dict:
    try:
        return QuotaAlertEmailService().send_test_email(
            notification_settings=payload,
            recipient_email=current_user.email,
        )
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)


def _secret_update_action(*, secret: str | None, clear: bool) -> str:
    if clear:
        return "cleared"
    if secret:
        return "replaced"
    return "preserved"


def _provider_audit_metadata(
    payload: OIDCProviderAdminPayload | LDAPProviderAdminPayload,
    *,
    fields: tuple[str, ...],
    secret_action_field: str,
    secret_action: str,
) -> dict:
    return {
        "provider_id": payload.provider_id,
        "fields": list(fields),
        "enabled": payload.enabled,
        secret_action_field: secret_action,
    }
