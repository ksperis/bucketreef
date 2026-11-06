# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW user creation, profile, configuration, and metrics routes."""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.ceph_admin import (
    CephAdminEntityMetrics,
    CephAdminRgwGeneratedAccessKey,
    CephAdminRgwUserConfigUpdate,
    CephAdminRgwUserCreate,
    CephAdminRgwUserCreateResponse,
    CephAdminRgwUserDetail,
)
from app.routers.ceph_admin import user_keys
from app.routers.ceph_admin.dependencies import get_ceph_admin_context
from app.services.ceph_admin_account_access import (
    load_account_payload,
    optional_account_lookup_enabled,
    resolve_optional_account_name,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services.ceph_admin_user_access import (
    load_user_payload,
    require_user_scope,
    serialize_access_keys,
)
from app.services.ceph_admin_user_profile_service import (
    CephAdminUserProfileConflictError,
    CephAdminUserProfileMutationService,
    CephAdminUserProfileNotFoundError,
    CephAdminUserProfileServiceError,
)
from app.services.ceph_admin_user_payloads import build_user_detail, extract_user_fields
from app.services.ceph_admin_identity_listing_cache import invalidate_users_listing_cache
from app.services.ceph_admin_audit import record_ceph_admin_action
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.rgw_payloads import (
    extract_bucket_list,
    extract_rgw_account_tenant,
)
from app.utils.usage_stats import summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])
router.include_router(user_keys.router)

def _load_user_detail(uid: str, tenant: Optional[str], ctx: CephAdminContext) -> CephAdminRgwUserDetail:
    payload = load_user_payload(uid, tenant, ctx.rgw_admin)
    fields = extract_user_fields(payload, {"account"})
    account_name = resolve_optional_account_name(
        fields.account_id,
        fields.account_name,
        ctx.rgw_admin,
        account_lookup_enabled=optional_account_lookup_enabled(ctx.endpoint),
    )
    return build_user_detail(
        payload,
        uid_fallback=uid,
        tenant_fallback=tenant,
        account_name=account_name,
        keys=serialize_access_keys(ctx.rgw_admin.list_user_keys(uid, tenant=tenant)),
    )


def _extract_generated_key_from_payload(
    raw: Any,
    rgw_admin: RGWAdminClient,
) -> Optional[CephAdminRgwGeneratedAccessKey]:
    access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
        rgw_admin.extract_keys(raw)
    )
    if not access_key or not secret_key:
        return None
    return CephAdminRgwGeneratedAccessKey(
        access_key=access_key,
        secret_key=secret_key,
    )


def _resolve_create_user_scope(
    payload: CephAdminRgwUserCreate,
    ctx: CephAdminContext,
) -> tuple[str, Optional[str], Optional[str]]:
    uid = payload.uid.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")

    tenant = payload.tenant.strip() if isinstance(payload.tenant, str) else None
    tenant = tenant or None
    account_id = payload.account_id.strip() if isinstance(payload.account_id, str) else None
    account_id = account_id or None
    if not account_id:
        return uid, tenant, None

    account_tenant = extract_rgw_account_tenant(
        load_account_payload(account_id, ctx.rgw_admin)
    )
    if tenant and tenant != account_tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="tenant does not match the selected RGW account",
        )
    return uid, account_tenant or None, account_id


def _raise_user_profile_service_error(exc: CephAdminUserProfileServiceError) -> None:
    if isinstance(exc, CephAdminUserProfileConflictError):
        status_code = status.HTTP_409_CONFLICT
    elif isinstance(exc, CephAdminUserProfileNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
    else:
        status_code = status.HTTP_502_BAD_GATEWAY
    raise_http_exception_from_exception(status_code, exc)


@router.post("", response_model=CephAdminRgwUserCreateResponse, status_code=status.HTTP_201_CREATED)
def create_rgw_user(
    payload: CephAdminRgwUserCreate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserCreateResponse:
    uid, tenant, account_id = _resolve_create_user_scope(payload, ctx)
    mutations = CephAdminUserProfileMutationService(ctx.rgw_admin)
    try:
        # A manual create must never reuse another principal, even within the same account.
        mutations.ensure_uid_available(uid, tenant)
        create_result = mutations.create_user(
            payload,
            uid=uid,
            tenant=tenant,
            account_id=account_id,
        )

        # RGW can resolve the bare UID to another account. Verify the fresh record
        # before any profile, quota, or capability updates and before exposing a key.
        require_user_scope(uid, tenant, account_id, ctx.rgw_admin)
        field_set = mutations.apply_created_configuration(
            payload,
            uid=uid,
            tenant=tenant,
        )
    except CephAdminUserProfileServiceError as exc:
        _raise_user_profile_service_error(exc)

    invalidate_users_listing_cache(ctx.endpoint.id)
    detail = _load_user_detail(uid, tenant, ctx)
    generated_key = _extract_generated_key_from_payload(create_result, ctx.rgw_admin)
    record_ceph_admin_action(
        ctx,
        action="rgw_user.create",
        entity_type="rgw_user",
        entity_id=f"{tenant}${uid}" if tenant else uid,
        metadata={
            "account_id": account_id,
            "tenant": tenant,
            "generate_key": payload.generate_key,
            "fields": sorted(field_set),
        },
    )
    return CephAdminRgwUserCreateResponse(detail=detail, generated_key=generated_key)


@router.get("/{user_id}")
def get_rgw_user(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    return load_user_payload(user_id, tenant, ctx.rgw_admin)


@router.get("/{user_id}/detail", response_model=CephAdminRgwUserDetail)
def get_rgw_user_detail(
    user_id: str,
    tenant: Optional[str] = None,
    expected_account_id: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserDetail:
    if expected_account_id is not None:
        require_user_scope(
            user_id.strip(),
            tenant,
            expected_account_id,
            ctx.rgw_admin,
        )
    return _load_user_detail(user_id.strip(), tenant, ctx)


@router.patch("/{user_id}/config", response_model=CephAdminRgwUserDetail)
def update_rgw_user_config(
    user_id: str,
    update: CephAdminRgwUserConfigUpdate,
    tenant: Optional[str] = None,
    expected_account_id: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserDetail:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    require_user_scope(uid, tenant, expected_account_id, ctx.rgw_admin)
    mutations = CephAdminUserProfileMutationService(ctx.rgw_admin)
    try:
        field_set = mutations.apply_updated_configuration(
            update,
            uid=uid,
            tenant=tenant,
        )
    except CephAdminUserProfileServiceError as exc:
        _raise_user_profile_service_error(exc)

    invalidate_users_listing_cache(ctx.endpoint.id)
    record_ceph_admin_action(
        ctx,
        action="rgw_user.update",
        entity_type="rgw_user",
        entity_id=f"{tenant}${uid}" if tenant else uid,
        metadata={"fields": sorted(field_set)},
    )
    return _load_user_detail(uid, tenant, ctx)


@router.get("/{user_id}/metrics", response_model=CephAdminEntityMetrics)
def get_rgw_user_metrics(
    user_id: str,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminEntityMetrics:
    uid = user_id.strip()
    if not uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    lookup_uid = f"{tenant}${uid}" if tenant else uid
    try:
        payload = ctx.rgw_admin.get_all_buckets(uid=lookup_uid, with_stats=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    bucket_usage, total_bytes, total_objects, bucket_count = summarize_bucket_usage(extract_bucket_list(payload))
    return CephAdminEntityMetrics(
        total_bytes=total_bytes,
        total_objects=total_objects,
        bucket_count=bucket_count,
        bucket_usage=bucket_usage,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )
