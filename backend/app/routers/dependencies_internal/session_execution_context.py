# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db import S3Account, StorageEndpoint
from app.services.access_context_contracts import AccountCapabilities, ManagerSessionPrincipal

from app.services import app_settings_service
from app.services.s3_accounts_service import get_s3_accounts_service
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_endpoints_service import get_storage_endpoints_service
from app.utils.s3_endpoint import normalize_s3_endpoint, resolve_s3_endpoint

from .workspace_context import resolve_account_by_id


def _resolve_default_endpoint(db: Session) -> StorageEndpoint:
    service = get_storage_endpoints_service(db)
    service.ensure_default_endpoint()
    endpoint = service.get_default_endpoint_record()
    if endpoint is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Default storage endpoint is not configured",
        )
    return endpoint


def _resolve_session_account_record(
    db: Session,
    actor: ManagerSessionPrincipal,
    account_id: Optional[int],
) -> Optional[S3Account]:
    if not actor.account_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="S3Account context unavailable for session",
        )
    if account_id and account_id > 0:
        account = resolve_account_by_id(db, account_id)
        if account.rgw_account_id.lower() != actor.account_id.lower():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not authorized for this account",
            )
        return account
    return get_s3_accounts_service(db).find_account_by_rgw_id(actor.account_id)


def _resolve_session_storage_endpoint(
    db: Session,
    account: Optional[S3Account],
    requested_endpoint: Optional[str],
    *,
    metadata_only: bool,
) -> tuple[Optional[str], Optional[StorageEndpoint]]:
    if not requested_endpoint and (account is None or not resolve_s3_endpoint(account)):
        endpoint = (
            get_storage_endpoints_service(db).get_default_endpoint_record()
            if metadata_only
            else _resolve_default_endpoint(db)
        )
        if endpoint is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Default storage endpoint is not configured",
            )
        return endpoint.endpoint_url, endpoint
    if requested_endpoint:
        resolved = get_storage_endpoints_service(db).find_endpoint_record_by_url(
            requested_endpoint
        )
        return requested_endpoint, resolved
    return None, None


def _resolve_session_account(
    db: Session,
    actor: ManagerSessionPrincipal,
    account_id: Optional[int],
    requested_endpoint: Optional[str] = None,
    metadata_only: bool = False,
) -> S3ExecutionContext:
    account = _resolve_session_account_record(db, actor, account_id)
    context_name = account.name if account is not None else actor.account_name or actor.account_id
    context_rgw_account_id = account.rgw_account_id if account is not None else actor.account_id
    context_rgw_user_uid = account.rgw_user_uid if account is not None else actor.user_uid
    context_email = account.email if account is not None else None
    context_endpoint = account.storage_endpoint if account is not None else None
    context_endpoint_id = account.storage_endpoint_id if account is not None else None
    requested_endpoint, resolved_endpoint = _resolve_session_storage_endpoint(
        db,
        account,
        requested_endpoint,
        metadata_only=metadata_only,
    )
    if resolved_endpoint:
        context_endpoint_id = resolved_endpoint.id
        context_endpoint = resolved_endpoint
    return S3ExecutionContext(
        context_id=str(account.id) if account is not None else f"session:{actor.account_id}",
        context_kind="session",
        id=account.id if account is not None else None,
        name=context_name,
        rgw_account_id=context_rgw_account_id,
        email=context_email,
        rgw_user_uid=context_rgw_user_uid,
        rgw_tenant=account.rgw_tenant if account is not None else None,
        access_key=None if metadata_only else actor.access_key,
        secret_key=None if metadata_only else actor.secret_key,
        storage_endpoint_id=context_endpoint_id,
        storage_endpoint=context_endpoint,
        source_account=account,
        session_endpoint=requested_endpoint,
        manager_capabilities=AccountCapabilities(
            can_manage_buckets=actor.capabilities.can_manage_buckets,
            can_manage_iam=actor.capabilities.can_manage_iam,
            can_view_root_key=False,
            using_root_key=False,
        ),
    )


def resolve_requested_session_endpoint(
    db: Session,
    actor: ManagerSessionPrincipal,
    requested_endpoint: Optional[str],
) -> Optional[str]:
    pinned_endpoint = normalize_s3_endpoint(actor.capabilities.endpoint_url)
    if pinned_endpoint:
        if requested_endpoint and requested_endpoint != pinned_endpoint:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Endpoint override is not allowed for this session",
            )
        return pinned_endpoint
    if not requested_endpoint:
        return None
    general = app_settings_service.load_app_settings_for_db(db).general
    if general.allow_login_custom_endpoint:
        return requested_endpoint
    if general.allow_login_endpoint_list:
        service = get_storage_endpoints_service(db)
        if any(endpoint.endpoint_url == requested_endpoint for endpoint in service.list_endpoints()):
            return requested_endpoint
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Endpoint is not allowed for this session",
    )


def resolve_manager_session_execution_context(
    db: Session,
    actor: ManagerSessionPrincipal,
    *,
    account_id: Optional[int],
    s3_user_id: Optional[int],
    connection_id: Optional[int],
    ceph_admin_endpoint_id: Optional[int],
    surface: str,
    requested_endpoint: Optional[str],
    metadata_only: bool,
) -> S3ExecutionContext:
    if s3_user_id is not None or connection_id is not None or ceph_admin_endpoint_id is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Sessions cannot assume this context",
        )
    if surface == "manager-browser" and not actor.capabilities.access_browser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Browser access is not allowed for this session",
        )
    return _resolve_session_account(
        db,
        actor,
        account_id,
        requested_endpoint=requested_endpoint,
        metadata_only=metadata_only,
    )
