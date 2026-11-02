# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.domain_errors import S3ConnectionNotFoundError, S3UserNotFoundError
from app.services.access_context_contracts import (
    AccountCapabilities,
    EffectiveAccountLink,
    ManagerActor,
    ManagerSessionPrincipal,
)

from app.db import S3Connection, S3User, User, UserS3Account

from app.services import effective_access_service
from app.services.effective_access_service import EffectiveAccessService
from app.services.execution_destination_service import (
    ExecutionDestinationError,
    ExecutionDestinationService,
)
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.s3_users_service import get_s3_users_service
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.s3_endpoint import (
    normalize_s3_endpoint,
    validate_user_supplied_s3_endpoint,
)
from app.utils.request_paths import path_matches_prefix

from .auth_session import get_current_actor
from .ceph_admin_context import resolve_ceph_admin_browser_context
from .portal_access import is_portal_browser_request, resolve_portal_browser_context
from .session_execution_context import (
    resolve_manager_session_execution_context,
    resolve_requested_session_endpoint,
)
from .workspace_context import resolve_account_by_id, resolve_user_account_link, resolve_workspace_surface


settings = get_settings()


def _parse_execution_endpoint_id(value: object) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        endpoint_id = int(value)
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid execution endpoint identifier",
        )
    if endpoint_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid execution endpoint identifier",
        )
    return endpoint_id

def _parse_execution_context_selector(
    context_ref: Optional[str],
) -> tuple[Optional[int], Optional[int], Optional[int], Optional[int]]:
    if context_ref is None or context_ref == "":
        return None, None, None, None
    if isinstance(context_ref, str) and context_ref.startswith("conn-"):
        suffix = context_ref.split("conn-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid connection identifier")
        return None, None, int(suffix), None
    if isinstance(context_ref, str) and context_ref.startswith("s3u-"):
        suffix = context_ref.split("s3u-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid S3 user identifier")
        return None, int(suffix), None, None
    if isinstance(context_ref, str) and context_ref.startswith("ceph-admin-"):
        suffix = context_ref.split("ceph-admin-", 1)[1]
        if not suffix.isdigit():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Ceph Admin endpoint identifier")
        return None, None, None, int(suffix)
    try:
        value = int(context_ref)
        if value <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")
        return value, None, None, None
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid account identifier")


def _build_s3_connection_context(
    connection: S3Connection,
    *,
    capabilities: Optional[AccountCapabilities] = None,
) -> S3ExecutionContext:
    return S3ExecutionContext.from_connection(
        connection,
        manager_capabilities=capabilities,
    )


def _connection_iam_capable(conn: S3Connection) -> bool:
    return s3_connection_can_manage_iam(conn.capabilities)


def _build_s3_user_context(
    s3_user: S3User,
    *,
    capabilities: Optional[AccountCapabilities] = None,
) -> S3ExecutionContext:
    return S3ExecutionContext.from_s3_user(
        s3_user,
        manager_capabilities=capabilities,
    )


def _resolve_s3_user_context(
    db: Session,
    user: User,
    s3_user_id: int,
    *,
    surface: str,
    metadata_only: bool = False,
) -> S3ExecutionContext:
    if surface not in {"manager", "manager-browser"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="S3 users are not available in Browser")
    effective = effective_access_service.EffectiveAccessService(db).resolve_user(user)
    if not effective.has_s3_user(s3_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this S3 user")
    if surface == "manager-browser" and not effective.can_browse_s3_user(s3_user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager Browser data access is not allowed for this S3 user",
        )

    try:
        s3_user = get_s3_users_service(db).get_user_record(s3_user_id)
    except S3UserNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3 user not found")

    if metadata_only:
        return S3ExecutionContext(
            context_id=f"s3u-{s3_user.id}", context_kind="s3_user", name=s3_user.name,
            access_key=None, secret_key=None, storage_endpoint=s3_user.storage_endpoint,
            storage_endpoint_id=s3_user.storage_endpoint_id,
        )
    return _build_s3_user_context(
        s3_user,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_iam=False,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

def _resolve_connection_context(
    db: Session,
    user: User,
    connection_id: int,
    *,
    surface: str,
    touch_usage: bool = True,
    metadata_only: bool = False,
) -> S3ExecutionContext:
    """Resolve a connection through the same policy used by the catalogue."""
    connections = S3ConnectionsService(db)
    try:
        conn = connections.get_record(connection_id)
    except S3ConnectionNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="S3Connection not found")
    service = effective_access_service.EffectiveAccessService(db)
    effective = service.resolve_user(user)
    allowed = (
        service.manager_browser_connection_is_allowed(user, conn)
        if surface == "manager-browser"
        else service.connection_is_allowed(user, conn, workspace=surface, resolved=effective)
    )
    if not allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Connection is not authorized in this workspace")

    user_supplied_manual_endpoint = (
        not conn.is_shared
        and not conn.server_managed
        and conn.storage_endpoint_id is None
    )
    if user_supplied_manual_endpoint:
        try:
            details = resolve_connection_details(conn)
            validate_user_supplied_s3_endpoint(details.endpoint_url or "", field_name="Endpoint URL")
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Custom S3 endpoint is not allowed by outbound policy",
            ) from exc

    # Keep a minimal usage signal for UX (recently used sorting / hints).
    if metadata_only:
        details = resolve_connection_details(conn)
        return S3ExecutionContext(
            context_id=f"conn-{conn.id}", context_kind="connection", name=conn.name,
            access_key=None, secret_key=None, storage_endpoint=conn.storage_endpoint,
            storage_endpoint_id=conn.storage_endpoint_id, session_endpoint=details.endpoint_url,
            session_region=details.region, session_force_path_style=details.force_path_style,
            session_verify_tls=details.verify_tls, s3_connection_id=conn.id,
        )
    if touch_usage:
        connections.touch_usage_best_effort(conn)
    can_manage_iam = _connection_iam_capable(conn)
    return _build_s3_connection_context(
        conn,
        capabilities=AccountCapabilities(
            can_manage_buckets=True,
            can_manage_iam=can_manage_iam,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )

def manager_membership_capabilities(
    link: UserS3Account | EffectiveAccountLink,
) -> AccountCapabilities:
    is_account_admin = EffectiveAccessService.manager_account_allowed(link)
    if not is_account_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this account")
    return AccountCapabilities(
        can_manage_buckets=True,
        can_manage_iam=True,
        can_view_root_key=True,
        using_root_key=True,
    )


def _resolve_selected_execution_context(
    db: Session,
    user: User,
    *,
    s3_user_id: Optional[int],
    connection_id: Optional[int],
    ceph_admin_endpoint_id: Optional[int],
    surface: str,
    metadata_only: bool,
    is_storage_ops_surface: bool,
) -> S3ExecutionContext | None:
    if ceph_admin_endpoint_id is not None:
        if surface == "manager-browser":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Ceph Admin contexts are not available in Manager Browser",
            )
        return resolve_ceph_admin_browser_context(
            db,
            user,
            ceph_admin_endpoint_id,
            surface=surface,
            metadata_only=metadata_only,
        )
    if connection_id is not None:
        return _resolve_connection_context(
            db,
            user,
            connection_id,
            surface=surface,
            touch_usage=not is_storage_ops_surface,
            metadata_only=metadata_only,
        )
    if s3_user_id is not None:
        return _resolve_s3_user_context(
            db,
            user,
            s3_user_id,
            surface=surface,
            metadata_only=metadata_only,
        )
    return None


def _resolve_account_execution_context(
    db: Session,
    user: User,
    *,
    request: Request,
    account_id: Optional[int],
    surface: str,
    portal_browser: bool,
    metadata_only: bool,
) -> S3ExecutionContext:
    if surface == "browser" and not portal_browser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accounts are not available in standard Browser",
        )

    account, link = resolve_user_account_link(db, user, account_id, allow_default=False)
    if portal_browser:
        return resolve_portal_browser_context(
            db,
            user,
            account,
            link,
            request=request,
            metadata_only=metadata_only,
        )
    if surface == "manager-browser" and not (
        isinstance(link, EffectiveAccountLink) and link.manager_browser_allowed
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manager Browser data access requires account administrator and explicit data access on the same association",
        )

    capabilities = manager_membership_capabilities(link)
    if metadata_only:
        return S3ExecutionContext.from_account(account, manager_capabilities=capabilities)

    access_key, secret_key = account.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Admin credentials are not configured for this account",
        )
    return S3ExecutionContext.from_account(
        account,
        access_key=access_key,
        secret_key=secret_key,
        manager_capabilities=capabilities,
    )


def _resolve_user_execution_context(
    db: Session,
    user: User,
    *,
    request: Request,
    account_id: Optional[int],
    s3_user_id: Optional[int],
    connection_id: Optional[int],
    ceph_admin_endpoint_id: Optional[int],
    surface: str,
    portal_browser: bool,
    metadata_only: bool,
    is_storage_ops_surface: bool,
) -> S3ExecutionContext:
    selected = _resolve_selected_execution_context(
        db,
        user,
        s3_user_id=s3_user_id,
        connection_id=connection_id,
        ceph_admin_endpoint_id=ceph_admin_endpoint_id,
        surface=surface,
        metadata_only=metadata_only,
        is_storage_ops_surface=is_storage_ops_surface,
    )
    if selected is not None:
        return selected
    return _resolve_account_execution_context(
        db,
        user,
        request=request,
        account_id=account_id,
        surface=surface,
        portal_browser=portal_browser,
        metadata_only=metadata_only,
    )


def _apply_user_execution_destination(
    db: Session,
    user: User,
    execution_context: S3ExecutionContext,
    execution_endpoint_id: int,
    *,
    surface: str,
    portal_browser: bool,
    is_storage_ops_surface: bool,
) -> S3ExecutionContext:
    try:
        return ExecutionDestinationService(db).apply_user_override(
            user,
            execution_context,
            execution_endpoint_id,
            surface=surface,
            portal_browser=portal_browser,
            is_storage_ops_surface=is_storage_ops_surface,
        )
    except ExecutionDestinationError as exc:
        error_by_reason = {
            "unavailable_context": (
                status.HTTP_403_FORBIDDEN,
                "Execution endpoint override is not available for this context",
            ),
            "missing_origin": (
                status.HTTP_400_BAD_REQUEST,
                "Selected context has no configured storage endpoint",
            ),
            "temporary_credentials": (
                status.HTTP_403_FORBIDDEN,
                "RGW multisite endpoint switching is not available for temporary connection credentials",
            ),
            "not_allowed": (
                status.HTTP_403_FORBIDDEN,
                "RGW multisite endpoint switching is not allowed for this user or context",
            ),
            "destination_not_found": (
                status.HTTP_404_NOT_FOUND,
                "Execution endpoint not found",
            ),
            "incompatible_destination": (
                status.HTTP_400_BAD_REQUEST,
                "Execution endpoint is not in the same RGW realm and zonegroup",
            ),
        }
        status_code, detail = error_by_reason[exc.reason]
        raise HTTPException(
            status_code=status_code,
            detail=detail,
        ) from exc


def get_s3_execution_context(
    request: Request,
    context_ref: Optional[str] = Query(default=None, alias="context_id"),
    execution_endpoint_id: Annotated[Optional[int], Query(gt=0)] = None,
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
) -> S3ExecutionContext:
    return resolve_s3_execution_context(
        request,
        context_ref,
        actor,
        db,
        execution_endpoint_id=execution_endpoint_id,
    )


def _resolve_openstack_execution_context(
    request: Request,
    context_ref: str,
    actor: ManagerActor,
    db: Session,
    *,
    metadata_only: bool,
    workspace: Optional[str],
    requested_execution_endpoint_id: Optional[int],
) -> S3ExecutionContext:
    if requested_execution_endpoint_id is not None:
        raise HTTPException(403, "Execution endpoint override is not available for OpenStack contexts")

    from app.services.auth_session_guards import current_auth_session
    from app.services.openstack_service import OpenStackService

    if not isinstance(actor, User) or not request or request.headers.get("authorization"):
        raise HTTPException(403, "OpenStack contexts require an interactive UI session")
    surface = resolve_workspace_surface(request)
    restricted_namespace = any(
        path_matches_prefix(str(request.url.path), f"{settings.api_prefix}/{prefix}")
        for prefix in ("storage-ops", "ceph-admin", "portal", "admin")
    )
    if (
        restricted_namespace
        or workspace == "portal"
        or surface not in {"browser", "manager", "manager-browser"}
        or is_portal_browser_request(request, surface)
    ):
        raise HTTPException(403, "OpenStack context is not available in this workspace")
    auth = current_auth_session(request, db)
    return OpenStackService(db).resolve(
        actor,
        auth.id,
        context_ref,
        metadata_only=metadata_only,
    )


def _execution_surface_context(
    request: Request,
    workspace: Optional[str],
) -> tuple[str, bool, bool]:
    surface = (
        "manager-browser" if workspace == "manager" else "browser"
    ) if workspace is not None else resolve_workspace_surface(request)
    portal_browser = (
        workspace == "portal"
        if workspace is not None
        else is_portal_browser_request(request, surface)
    )
    is_storage_ops_surface = bool(
        request
        and path_matches_prefix(
            str(request.url.path),
            f"{settings.api_prefix}/storage-ops",
        )
    )
    return surface, portal_browser, is_storage_ops_surface


def _resolve_actor_requested_endpoint(
    request: Request,
    actor: ManagerActor,
    db: Session,
    requested_execution_endpoint_id: Optional[int],
) -> Optional[str]:
    requested_endpoint = (
        normalize_s3_endpoint(request.headers.get("X-S3-Endpoint"))
        if request
        else None
    )
    if not isinstance(actor, ManagerSessionPrincipal):
        return None
    if requested_execution_endpoint_id is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Execution endpoint override is not available for S3 sessions",
        )
    return resolve_requested_session_endpoint(db, actor, requested_endpoint)


def resolve_s3_execution_context(
    request: Request,
    context_ref: Optional[str],
    actor: ManagerActor,
    db: Session,
    *,
    metadata_only: bool = False,
    workspace: Optional[str] = None,
    execution_endpoint_id: Optional[int] = None,
) -> S3ExecutionContext:
    """Share exact-context authorization with read-only transfer-policy resolution."""
    request_query_params = getattr(request, "query_params", None) if request else None
    requested_execution_endpoint_id = _parse_execution_endpoint_id(
        execution_endpoint_id
        if execution_endpoint_id is not None
        else request_query_params.get("execution_endpoint_id") if request_query_params is not None else None
    )
    if isinstance(context_ref, str) and context_ref.startswith("os-"):
        return _resolve_openstack_execution_context(
            request,
            context_ref,
            actor,
            db,
            metadata_only=metadata_only,
            workspace=workspace,
            requested_execution_endpoint_id=requested_execution_endpoint_id,
        )
    account_id, s3_user_id, connection_id, ceph_admin_endpoint_id = _parse_execution_context_selector(context_ref)
    surface, portal_browser, is_storage_ops_surface = _execution_surface_context(
        request,
        workspace,
    )
    requested_endpoint = _resolve_actor_requested_endpoint(
        request,
        actor,
        db,
        requested_execution_endpoint_id,
    )
    if isinstance(actor, User):
        execution_context = _resolve_user_execution_context(
            db,
            actor,
            request=request,
            account_id=account_id,
            s3_user_id=s3_user_id,
            connection_id=connection_id,
            ceph_admin_endpoint_id=ceph_admin_endpoint_id,
            surface=surface,
            portal_browser=portal_browser,
            metadata_only=metadata_only,
            is_storage_ops_surface=is_storage_ops_surface,
        )
        if requested_execution_endpoint_id is None:
            return execution_context
        return _apply_user_execution_destination(
            db,
            actor,
            execution_context,
            requested_execution_endpoint_id,
            surface=surface,
            portal_browser=portal_browser,
            is_storage_ops_surface=is_storage_ops_surface,
        )
    return resolve_manager_session_execution_context(
        db,
        actor,
        account_id=account_id,
        s3_user_id=s3_user_id,
        connection_id=connection_id,
        ceph_admin_endpoint_id=ceph_admin_endpoint_id,
        surface=surface,
        requested_endpoint=requested_endpoint,
        metadata_only=metadata_only,
    )
