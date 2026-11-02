# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User as DbUser
from app.core.domain_enums import UserRole, is_superadmin_ui_role
from app.models.user import (
    PaginatedUserSummariesResponse,
    PaginatedUsersResponse,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.models.admin_ldap_import import LDAPImportRequest, LDAPImportSearchResponse
from app.routers.dependencies import (
    get_audit_service,
    get_current_ui_admin,
    get_users_service_dependency,
)
from app.services.audit_service import AuditService
from app.services.user_associations_service import (
    UserAssociationsService,
    get_user_associations_service,
)
from app.services.users_service import UsersService
from app.services.admin_ldap_user_import_service import AdminLdapUserImportService
from app.services.ldap_service import (
    LDAPAuthenticationError,
    LDAPConfigurationError,
    LDAPProviderNotFoundError,
    get_ldap_auth_service,
)
from app.services.avatar_image_service import MAX_AVATAR_BYTES
from app.services.user_avatar_service import UserAvatarService
from app.services.identity_security_policy import (
    admin_user_update_requires_step_up,
    ensure_actor_can_assign_role,
    ensure_actor_can_manage_user,
    require_admin_interactive_session,
    require_admin_sensitive_action,
)
from app.utils.http_errors import (
    raise_bad_request_from_value_error,
    raise_http_error_from_value_error,
)

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


def get_user_associations_service_dependency(
    db: Session = Depends(get_db),
) -> UserAssociationsService:
    return get_user_associations_service(db)


def _ldap_import_service(db: Session, users_service: UsersService) -> AdminLdapUserImportService:
    return AdminLdapUserImportService(db, get_ldap_auth_service(db), users_service)


def _raise_ldap_import_error(exc: Exception) -> None:
    if isinstance(exc, LDAPProviderNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LDAP provider not found") from exc
    if isinstance(exc, LDAPConfigurationError):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="LDAP directory is unavailable or misconfigured",
        ) from exc
    if isinstance(exc, LDAPAuthenticationError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="LDAP import selection is no longer valid; search again",
        ) from exc
    if isinstance(exc, ValueError):
        raise_bad_request_from_value_error(exc)
    raise exc


def _require_superadmin_for_privileged_change(
    current_user: DbUser,
    *,
    role: Optional[str],
    can_access_ceph_admin: Optional[bool],
) -> None:
    wants_privileged_role = role in {
        UserRole.UI_ADMIN.value,
        UserRole.UI_SUPERADMIN.value,
    }
    wants_ceph_admin_grant = can_access_ceph_admin is True
    if (wants_privileged_role or wants_ceph_admin_grant) and not is_superadmin_ui_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin users can assign administrator roles or grant privileged Ceph access",
        )


def _safe_update_audit_metadata(payload: UserUpdate) -> dict:
    metadata = payload.model_dump(exclude_unset=True)
    if "password" in metadata:
        metadata["password"] = "<redacted>"
    return metadata


def _require_superadmin_for_group_privileges(
    current_user: DbUser,
    associations_service: UserAssociationsService,
    *,
    group_ids: Optional[list[int]],
) -> None:
    if group_ids is None:
        return
    grants_ceph_admin = associations_service.groups_grant_ceph_admin(
        group_ids
    )
    if grants_ceph_admin and not is_superadmin_ui_role(current_user.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only superadmin users can assign groups that grant privileged Ceph access",
        )


@router.get("", response_model=PaginatedUsersResponse)
def list_users(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = Query(None),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> PaginatedUsersResponse:
    require_admin_interactive_session(request, db, current_user)
    items, total = users_service.paginate_users(
        page=page,
        page_size=page_size,
        search=search,
        sort_field=sort_by,
        sort_direction=sort_dir,
    )
    has_next = page * page_size < total
    return PaginatedUsersResponse(items=items, total=total, page=page, page_size=page_size, has_next=has_next)


@router.get("/options", response_model=PaginatedUserSummariesResponse)
def list_user_options(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=200),
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    db: Session = Depends(get_db),
) -> PaginatedUserSummariesResponse:
    require_admin_interactive_session(request, db, current_user)
    items, total = users_service.paginate_user_summaries(
        page=page,
        page_size=page_size,
        search=search,
    )
    return PaginatedUserSummariesResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        has_next=page * page_size < total,
    )


@router.get("/ldap/search", response_model=LDAPImportSearchResponse)
def search_ldap_users_for_import(
    request: Request,
    provider_id: str = Query(..., min_length=1, max_length=128),
    q: str = Query(..., min_length=2, max_length=256),
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
) -> LDAPImportSearchResponse:
    session = require_admin_interactive_session(request, users_service.db, current_user)
    try:
        return _ldap_import_service(users_service.db, users_service).search(
            actor=current_user,
            session=session,
            provider_id=provider_id,
            query=q,
        )
    except Exception as exc:
        _raise_ldap_import_error(exc)


@router.post("/ldap/import", response_model=UserOut)
def import_ldap_user(
    request: Request,
    payload: LDAPImportRequest,
    users_service: UsersService = Depends(get_users_service_dependency),
    associations_service: UserAssociationsService = Depends(get_user_associations_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    if payload.action == "create":
        assert payload.create is not None
        ensure_actor_can_assign_role(current_user, payload.create.role)
        _require_superadmin_for_privileged_change(
            current_user,
            role=payload.create.role,
            can_access_ceph_admin=payload.create.can_access_ceph_admin,
        )
        _require_superadmin_for_group_privileges(
            current_user,
            associations_service,
            group_ids=payload.create.group_ids,
        )
    else:
        assert payload.target_user_id is not None
        target = users_service.get_by_id(payload.target_user_id)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        ensure_actor_can_manage_user(
            current_user,
            target,
            allow_self=is_superadmin_ui_role(current_user.role),
        )

    require_admin_sensitive_action(request, users_service.db, current_user)
    session = require_admin_interactive_session(request, users_service.db, current_user)
    try:
        user, provider_id = _ldap_import_service(users_service.db, users_service).import_user(
            payload,
            actor=current_user,
            session=session,
        )
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action=f"{payload.action}_ldap_ui_user",
            entity_type="ui_user",
            entity_id=str(user.id),
            metadata={"provider_id": provider_id, "mode": payload.action},
        )
        return users_service.user_to_out(user)
    except Exception as exc:
        _raise_ldap_import_error(exc)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    request: Request,
    payload: UserCreate,
    users_service: UsersService = Depends(get_users_service_dependency),
    associations_service: UserAssociationsService = Depends(get_user_associations_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    ensure_actor_can_assign_role(
        current_user,
        payload.role,
    )
    _require_superadmin_for_privileged_change(
        current_user,
        role=payload.role,
        can_access_ceph_admin=payload.can_access_ceph_admin,
    )
    _require_superadmin_for_group_privileges(
        current_user,
        associations_service,
        group_ids=payload.group_ids,
    )
    require_admin_sensitive_action(request, users_service.db, current_user)
    try:
        user = users_service.create_user(payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="create_ui_user",
            entity_type="ui_user",
            entity_id=str(user.id),
            metadata={
                "email": user.email,
                "role": user.role,
                "account_ids": [link.account_id for link in payload.account_links],
                "s3_user_ids": [link.s3_user_id for link in payload.s3_user_links],
                "s3_connection_ids": payload.s3_connection_ids,
                "group_ids": payload.group_ids,
                "openstack_cloud_ids": payload.openstack_cloud_ids,
            },
        )
        return users_service.user_to_out(user)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    request: Request,
    user_id: int,
    payload: UserUpdate,
    users_service: UsersService = Depends(get_users_service_dependency),
    associations_service: UserAssociationsService = Depends(get_user_associations_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    target = users_service.get_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    ensure_actor_can_manage_user(current_user, target, allow_self=is_superadmin_ui_role(current_user.role))
    if payload.role is not None:
        ensure_actor_can_assign_role(current_user, payload.role)
    try:
        users_service.validate_superadmin_update(current_user, target, payload)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    _require_superadmin_for_privileged_change(
        current_user,
        role=payload.role,
        can_access_ceph_admin=payload.can_access_ceph_admin,
    )
    _require_superadmin_for_group_privileges(
        current_user,
        associations_service,
        group_ids=payload.group_ids,
    )
    require_admin_interactive_session(request, users_service.db, current_user)
    if admin_user_update_requires_step_up(target, payload):
        require_admin_sensitive_action(request, users_service.db, current_user)
    try:
        user = users_service.update_user(user_id, payload)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="update_ui_user",
            entity_type="ui_user",
            entity_id=str(user_id),
            metadata=_safe_update_audit_metadata(payload),
        )
        return users_service.user_to_out(user)
    except ValueError as exc:
        raise_http_error_from_value_error(exc)


def _avatar_target(request: Request, user_id: int, users_service: UsersService, actor: DbUser) -> DbUser:
    target = users_service.get_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    ensure_actor_can_manage_user(actor, target, allow_self=is_superadmin_ui_role(actor.role))
    require_admin_interactive_session(request, users_service.db, actor)
    return target


@router.put("/{user_id}/avatar", response_model=UserOut)
async def upload_user_avatar(
    request: Request,
    user_id: int,
    file: UploadFile = File(...),
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    target = _avatar_target(request, user_id, users_service, current_user)
    payload = await file.read(MAX_AVATAR_BYTES + 1)
    try:
        UserAvatarService(users_service.db).store_uploaded_image(target, payload, file.content_type)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    audit_service.record_action(
        user=current_user, scope="admin", action="upload_avatar", entity_type="ui_user", entity_id=str(target.id),
        metadata={"content_type": target.avatar_content_type, "size_bytes": len(payload)},
    )
    return users_service.user_to_out(target)


@router.delete("/{user_id}/avatar", response_model=UserOut)
def delete_user_avatar(
    request: Request,
    user_id: int,
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> UserOut:
    target = _avatar_target(request, user_id, users_service, current_user)
    UserAvatarService(users_service.db).remove_uploaded_image(target)
    audit_service.record_action(
        user=current_user, scope="admin", action="delete_avatar", entity_type="ui_user", entity_id=str(target.id),
    )
    return users_service.user_to_out(target)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    request: Request,
    user_id: int,
    users_service: UsersService = Depends(get_users_service_dependency),
    current_user: DbUser = Depends(get_current_ui_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> None:
    if current_user.id == user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="You cannot delete your own user")
    target = users_service.get_by_id(user_id)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    ensure_actor_can_manage_user(current_user, target)
    try:
        users_service.validate_superadmin_delete(current_user, target)
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    require_admin_sensitive_action(request, users_service.db, current_user)
    try:
        users_service.delete_user(user_id)
        audit_service.record_action(
            user=current_user,
            scope="admin",
            action="delete_ui_user",
            entity_type="ui_user",
            entity_id=str(user_id),
        )
    except ValueError as exc:
        raise_http_error_from_value_error(exc)
