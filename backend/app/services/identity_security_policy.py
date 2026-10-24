# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import (
    AuthSession,
    S3Connection,
    UiGroup,
    UiGroupS3Connection,
    User,
    UserRole,
    is_admin_ui_role,
    is_superadmin_ui_role,
)
from app.models.s3_connection_admin import S3ConnectionAdminUpdate
from app.models.ui_group import UiGroupCreate, UiGroupUpdate
from app.models.user import ManagerToolAccess, UserUpdate
from app.services.app_settings_service import load_app_settings_for_db
from app.services.auth_session_guards import current_auth_session, require_recent_mfa, require_recent_primary_auth
from app.services.manager_tool_access import read_manager_tool_access
from app.services.webauthn_service import WebAuthnService
from app.utils.normalize import normalize_optional_string
from app.utils.s3_connection_endpoint import resolve_connection_details


STANDARD_UI_ROLES = {UserRole.UI_USER.value, UserRole.UI_NONE.value}
PRIVILEGED_UI_ROLES = {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}
_DIRECT_ACCESS_FIELDS = (
    "can_access_ceph_admin",
    "can_access_storage_ops",
    "can_create_manual_private_connections",
    "can_provision_managed_private_connections",
    "browser_advanced_features_enabled",
)
_GROUP_DIRECT_ACCESS_FIELDS = _DIRECT_ACCESS_FIELDS


def _manager_tool_access_enabled(value: ManagerToolAccess | None) -> bool:
    if value is None:
        return False
    return any(bool(enabled) for enabled in value.model_dump().values())


def _direct_access_fields_changed(entity, payload, fields=_DIRECT_ACCESS_FIELDS) -> bool:
    return any(
        (requested := getattr(payload, field)) is not None
        and bool(requested) != bool(getattr(entity, field))
        for field in fields
    )


def _requested_ids_changed(requested, persisted) -> bool:
    if requested is None:
        return False
    return {int(value) for value in requested} != {int(value) for value in persisted}


def _manager_tool_access_changed(entity, requested: ManagerToolAccess | None) -> bool:
    return requested is not None and read_manager_tool_access(entity) != requested


def _admin_user_scalar_security_changed(user: User, payload: UserUpdate) -> bool:
    return any(
        (
            bool(payload.password),
            payload.email is not None
            and str(payload.email).strip() != str(user.email).strip(),
            payload.role is not None and payload.role != user.role,
            payload.is_active is not None
            and bool(payload.is_active) != bool(user.is_active),
        )
    )


def _admin_user_memberships_changed(user: User, payload: UserUpdate) -> bool:
    return _requested_ids_changed(
        payload.s3_connection_ids,
        (link.s3_connection_id for link in user.s3_connection_links),
    ) or _requested_ids_changed(
        payload.group_ids,
        (link.group_id for link in user.ui_group_links),
    )


def passkey_required_for_role(db: Session, role: str) -> bool:
    general = load_app_settings_for_db(db).general
    if role in PRIVILEGED_UI_ROLES:
        return bool(general.require_passkey_for_admins)
    if role in STANDARD_UI_ROLES:
        return bool(general.require_passkey_for_users)
    return False


def require_admin_interactive_session(
    request: Request,
    db: Session,
    actor: User,
) -> AuthSession:
    """Require an authorized administrator using a browser-backed UI session."""
    if not is_admin_ui_role(actor.role):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return current_auth_session(request, db)


def require_admin_sensitive_action(
    request: Request,
    db: Session,
    actor: User,
) -> None:
    """Require an interactive admin session and, when enabled, recent WebAuthn."""
    session = require_admin_interactive_session(request, db, actor)
    if load_app_settings_for_db(db).general.require_passkey_for_admins:
        if not WebAuthnService(db).is_recent(session):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Recent WebAuthn verification required",
            )


def _account_links_changed(user: User, payload: UserUpdate) -> bool:
    if payload.account_links is None:
        return False
    if payload.account_links and user.role == UserRole.UI_NONE.value:
        # The association service promotes ui_none to ui_user when account
        # access is persisted, even when the submitted links are unchanged.
        return True
    persisted = {
        (
            int(link.account_id),
            link.manager_role,
            link.portal_role,
            bool(link.allow_manager_browser_data_access),
        )
        for link in user.account_links
    }
    requested = {
        (
            int(link.account_id),
            link.manager_role,
            link.portal_role,
            bool(link.allow_manager_browser_data_access),
        )
        for link in payload.account_links
    }
    return persisted != requested


def _s3_user_links_changed(user: User, payload: UserUpdate) -> bool:
    if payload.s3_user_links is None:
        return False
    persisted = {
        (int(link.s3_user_id), bool(link.allow_manager_browser_data_access))
        for link in user.s3_user_links
    }
    requested = {
        (int(link.s3_user_id), bool(link.allow_manager_browser_data_access))
        for link in payload.s3_user_links
    }
    return persisted != requested


def admin_user_update_requires_step_up(user: User, payload: UserUpdate) -> bool:
    """Return whether an update would change persisted identity or access state."""
    return any(
        (
            _admin_user_scalar_security_changed(user, payload),
            _direct_access_fields_changed(user, payload),
            _manager_tool_access_changed(user, payload.manager_tool_access),
            _account_links_changed(user, payload),
            _s3_user_links_changed(user, payload),
            _admin_user_memberships_changed(user, payload),
        )
    )


def admin_group_create_requires_step_up(payload: UiGroupCreate) -> bool:
    """Return whether group creation introduces access-bearing state."""
    if payload.user_ids or payload.account_links or payload.s3_user_links or payload.s3_connection_ids:
        return True
    if any(bool(getattr(payload, field)) for field in _GROUP_DIRECT_ACCESS_FIELDS):
        return True
    return _manager_tool_access_enabled(payload.manager_tool_access)


def _group_account_links_changed(group: UiGroup, payload: UiGroupUpdate) -> bool:
    if payload.account_links is None:
        return False
    persisted = {
        (
            int(link.account_id),
            link.manager_role,
            link.portal_role,
            bool(link.allow_manager_browser_data_access),
        )
        for link in group.account_links
    }
    requested = {
        (
            int(link.account_id),
            link.manager_role,
            link.portal_role,
            bool(link.allow_manager_browser_data_access),
        )
        for link in payload.account_links
    }
    return persisted != requested


def _group_s3_user_links_changed(group: UiGroup, payload: UiGroupUpdate) -> bool:
    if payload.s3_user_links is None:
        return False
    persisted = {
        (int(link.s3_user_id), bool(link.allow_manager_browser_data_access))
        for link in group.s3_user_links
    }
    requested = {
        (int(link.s3_user_id), bool(link.allow_manager_browser_data_access))
        for link in payload.s3_user_links
    }
    return persisted != requested


def admin_group_update_requires_step_up(group: UiGroup, payload: UiGroupUpdate) -> bool:
    """Return whether a group update changes effective access or security state."""
    if _direct_access_fields_changed(group, payload, _GROUP_DIRECT_ACCESS_FIELDS):
        return True
    if _manager_tool_access_changed(group, payload.manager_tool_access):
        return True
    if _requested_ids_changed(
        payload.user_ids,
        (link.user_id for link in group.user_links),
    ):
        return True
    if _group_account_links_changed(group, payload) or _group_s3_user_links_changed(group, payload):
        return True
    return _requested_ids_changed(
        payload.s3_connection_ids,
        (link.s3_connection_id for link in group.s3_connection_links),
    )


def _s3_connection_assignments_changed(
    db: Session,
    connection: S3Connection,
    payload: S3ConnectionAdminUpdate,
) -> bool:
    if _requested_ids_changed(
        payload.user_ids,
        (link.user_id for link in connection.user_links),
    ):
        return True
    if payload.group_ids is None:
        return False
    persisted_group_ids = db.scalars(
        select(UiGroupS3Connection.group_id).where(
            UiGroupS3Connection.s3_connection_id == connection.id
        )
    ).all()
    return _requested_ids_changed(payload.group_ids, persisted_group_ids)


def _s3_connection_target_changed(
    connection: S3Connection,
    payload: S3ConnectionAdminUpdate,
) -> bool:
    details = resolve_connection_details(connection)
    fields_set = payload.model_fields_set
    if (
        "storage_endpoint_id" in fields_set
        and payload.storage_endpoint_id != connection.storage_endpoint_id
    ):
        return True

    text_fields = (
        ("endpoint_url", payload.endpoint_url, details.endpoint_url),
        ("region", payload.region, details.region),
        ("provider_hint", payload.provider_hint, details.provider),
    )
    if any(
        field in fields_set
        and normalize_optional_string(requested) != normalize_optional_string(current)
        for field, requested, current in text_fields
    ):
        return True

    boolean_fields = (
        ("force_path_style", payload.force_path_style, details.force_path_style),
        ("verify_tls", payload.verify_tls, details.verify_tls),
    )
    return any(
        field in fields_set and bool(requested) != bool(current)
        for field, requested, current in boolean_fields
    )


def admin_s3_connection_update_requires_step_up(
    db: Session,
    connection: S3Connection,
    payload: S3ConnectionAdminUpdate,
) -> bool:
    """Return whether a shared-connection update expands or changes sensitive access state."""
    if payload.remediation_action is not None or payload.credentials is not None:
        return True
    if payload.is_active is True and not bool(connection.is_active):
        return True
    return _s3_connection_assignments_changed(
        db,
        connection,
        payload,
    ) or _s3_connection_target_changed(connection, payload)


def require_self_service_security_action(
    request: Request,
    db: Session,
    user: User,
) -> None:
    """Use WebAuthn when enrolled/required, otherwise recent primary auth."""
    service = WebAuthnService(db)
    if service.has_credentials(user.id) or passkey_required_for_role(db, user.role):
        require_recent_mfa(request, db)
    else:
        require_recent_primary_auth(request, db)


def ensure_actor_can_manage_user(actor: User, target: User, *, allow_self: bool = False) -> None:
    if actor.id == target.id and not allow_self:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot perform this administrative action on your own account",
        )
    if is_superadmin_ui_role(actor.role):
        return
    if target.role not in STANDARD_UI_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrators can manage only standard users",
        )


def ensure_actor_can_assign_role(actor: User, role: str) -> None:
    if not is_superadmin_ui_role(actor.role) and role not in STANDARD_UI_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrators can assign only standard user roles",
        )
