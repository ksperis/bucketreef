# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW user creation, profile, configuration, and metrics routes."""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.models.ceph_admin import (
    CephAdminEntityMetrics,
    CephAdminRgwAccessKey,
    CephAdminRgwGeneratedAccessKey,
    CephAdminRgwQuotaConfig,
    CephAdminRgwUserConfigUpdate,
    CephAdminRgwUserCreate,
    CephAdminRgwUserCreateResponse,
    CephAdminRgwUserDetail,
)
from app.routers.ceph_admin import user_keys
from app.routers.ceph_admin.dependencies import get_ceph_admin_context
from app.services.ceph_admin_account_access import load_account_payload
from app.services.ceph_admin_context import CephAdminContext
from app.routers.ceph_admin.profile_common import nullable_update, raise_if_unsupported
from app.services.ceph_admin_user_access import (
    load_user_payload,
    optional_account_lookup_enabled,
    require_user_scope,
    serialize_access_keys,
)
from app.services.ceph_admin_user_identity import split_tenant_uid
from app.services.ceph_admin_identity_listing_cache import invalidate_users_listing_cache
from app.services.ceph_admin_audit import record_ceph_admin_action
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_caps import canonicalize_rgw_caps
from app.utils.rgw_payloads import (
    extract_bucket_list,
    extract_rgw_account_tenant,
    extract_rgw_quota_enabled,
    extract_rgw_user_payload,
    parse_rgw_bool,
    parse_rgw_int,
)
from app.utils.usage_stats import summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/users", tags=["ceph-admin-users"])
router.include_router(user_keys.router)

USER_UPDATE_FIELDS = (
    "display_name",
    "email",
    "suspended",
    "max_buckets",
    "op_mask",
    "system",
    "account_root",
)
USER_UPDATE_FIELD_SET = frozenset(USER_UPDATE_FIELDS)
USER_UPDATE_CLEAR_VALUES: dict[str, Any] = {
    "display_name": "",
    "email": "",
    "max_buckets": 0,
    "op_mask": "",
}
USER_QUOTA_FIELDS = frozenset({"quota_enabled", "quota_max_size_bytes", "quota_max_objects"})


def _extract_user_setting(payload: dict[str, Any], user_payload: dict[str, Any], *keys: str) -> Optional[str]:
    for key in keys:
        value = normalize_optional_scalar(user_payload.get(key))
        if value is not None:
            return value
        value = normalize_optional_scalar(payload.get(key))
        if value is not None:
            return value
    return None


def _extract_caps(payload: dict[str, Any]) -> list[str]:
    values = payload.get("caps")
    if values is None and isinstance(payload.get("user"), dict):
        values = payload["user"].get("caps")
    return canonicalize_rgw_caps(values)


def _resolve_user_identity(
    payload: dict[str, Any],
    *,
    uid_fallback: str,
    tenant_fallback: Optional[str],
) -> tuple[Optional[str], str]:
    user_payload = extract_rgw_user_payload(payload)
    uid_raw = normalize_optional_scalar(user_payload.get("uid") or payload.get("uid")) or uid_fallback
    tenant = tenant_fallback
    uid = uid_raw
    if "$" in uid_raw:
        tenant, uid = split_tenant_uid(uid_raw)
    return tenant, uid


def _build_user_detail(
    payload: dict[str, Any],
    *,
    uid_fallback: str,
    tenant_fallback: Optional[str],
    account_name: Optional[str] = None,
    keys: Optional[list[CephAdminRgwAccessKey]] = None,
) -> CephAdminRgwUserDetail:
    user_payload = extract_rgw_user_payload(payload)
    tenant, uid = _resolve_user_identity(payload, uid_fallback=uid_fallback, tenant_fallback=tenant_fallback)
    account_id = normalize_optional_scalar(payload.get("account_id") or user_payload.get("account_id"))
    quota_size, quota_objects = extract_quota_limits(payload, keys=("user_quota", "quota"))
    quota_enabled = extract_rgw_quota_enabled(
        payload,
        keys=("user_quota", "quota"),
    )
    quota = None
    if quota_enabled is not None or quota_size is not None or quota_objects is not None:
        quota = CephAdminRgwQuotaConfig(
            enabled=quota_enabled,
            max_size_bytes=quota_size,
            max_objects=quota_objects,
        )
    return CephAdminRgwUserDetail(
        uid=uid,
        tenant=tenant,
        display_name=normalize_optional_scalar(user_payload.get("display_name") or payload.get("display_name")),
        email=normalize_optional_scalar(user_payload.get("email") or payload.get("email")),
        account_id=account_id,
        account_name=account_name,
        suspended=parse_rgw_bool(user_payload.get("suspended") or payload.get("suspended")),
        admin=parse_rgw_bool(user_payload.get("admin") if "admin" in user_payload else payload.get("admin")),
        system=parse_rgw_bool(user_payload.get("system") if "system" in user_payload else payload.get("system")),
        account_root=parse_rgw_bool(user_payload.get("account_root") or payload.get("account_root")),
        max_buckets=parse_rgw_int(user_payload.get("max_buckets") or payload.get("max_buckets")),
        op_mask=normalize_optional_scalar(user_payload.get("op_mask") or payload.get("op_mask")),
        default_placement=_extract_user_setting(
            payload,
            user_payload,
            "default_placement",
            "default_placement_rule",
        ),
        default_storage_class=_extract_user_setting(payload, user_payload, "default_storage_class"),
        caps=_extract_caps(payload),
        quota=quota,
        keys=keys or [],
    )


def _load_user_detail(uid: str, tenant: Optional[str], ctx: CephAdminContext) -> CephAdminRgwUserDetail:
    payload = load_user_payload(uid, tenant, ctx.rgw_admin)
    user_values = extract_rgw_user_payload(payload)
    account_id = normalize_optional_scalar(payload.get("account_id") or user_values.get("account_id"))
    account_name = _resolve_account_name(
        account_id,
        ctx,
        payload_account_name=normalize_optional_scalar(payload.get("account_name") or user_values.get("account_name")),
    )
    return _build_user_detail(
        payload,
        uid_fallback=uid,
        tenant_fallback=tenant,
        account_name=account_name,
        keys=serialize_access_keys(ctx.rgw_admin.list_user_keys(uid, tenant=tenant)),
    )


def _user_update_params(
    update: CephAdminRgwUserCreate | CephAdminRgwUserConfigUpdate,
    field_set: set[str],
    *,
    clear_nulls: bool,
) -> dict[str, Any]:
    if not clear_nulls:
        return {
            field: getattr(update, field) if field in field_set else None
            for field in USER_UPDATE_FIELDS
        }
    return {
        field: nullable_update(
            getattr(update, field),
            field,
            field_set,
            USER_UPDATE_CLEAR_VALUES.get(field),
        )
        for field in USER_UPDATE_FIELDS
    }


def _apply_user_update(
    uid: str,
    tenant: Optional[str],
    params: dict[str, Any],
    ctx: CephAdminContext,
) -> None:
    try:
        result = ctx.rgw_admin.update_user(uid, tenant=tenant, **params)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if isinstance(result, dict) and result.get("conflict"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user update conflicted")
    raise_if_unsupported(result, "RGW user update is not supported on this cluster")


def _apply_user_quota_update(
    uid: str,
    tenant: Optional[str],
    *,
    max_size_bytes: Optional[int],
    max_objects: Optional[int],
    enabled: Optional[bool],
    ctx: CephAdminContext,
) -> None:
    try:
        result = ctx.rgw_admin.set_user_quota(
            uid,
            tenant=tenant,
            max_size_bytes=max_size_bytes,
            max_objects=max_objects,
            enabled=bool(enabled) if enabled is not None else True,
        )
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    raise_if_unsupported(result, "RGW user quota update is not supported on this cluster")


def _resolve_account_name(
    account_id: Optional[str],
    ctx: CephAdminContext,
    *,
    payload_account_name: Optional[str] = None,
) -> Optional[str]:
    if not account_id or optional_account_lookup_enabled(ctx.endpoint) is False:
        return payload_account_name
    try:
        account_payload = ctx.rgw_admin.get_account(
            account_id,
            allow_not_found=True,
            allow_not_implemented=True,
        )
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not isinstance(account_payload, dict) or account_payload.get("not_found"):
        return payload_account_name
    return normalize_optional_scalar(
        account_payload.get("name") or account_payload.get("display_name") or account_payload.get("account_name")
    ) or payload_account_name


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


def _apply_caps_update(
    uid: str,
    tenant: Optional[str],
    mode: str,
    values: list[str],
    ctx: CephAdminContext,
) -> None:
    caps_values = list(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))
    try:
        existing_caps = _extract_caps(load_user_payload(uid, tenant, ctx.rgw_admin))
        if mode == "replace":
            if existing_caps:
                ctx.rgw_admin.set_user_caps(uid, existing_caps, tenant=tenant, op="rm")
            if caps_values:
                ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
        elif mode == "add":
            if caps_values:
                ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="add")
        elif caps_values:
            ctx.rgw_admin.set_user_caps(uid, caps_values, tenant=tenant, op="rm")
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)


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


def _require_create_user_uid_available(
    uid: str,
    tenant: Optional[str],
    ctx: CephAdminContext,
) -> None:
    # A manual create must never reuse another principal, even within the same account.
    try:
        existing = ctx.rgw_admin.get_user(uid, tenant=tenant, allow_not_found=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if existing and not existing.get("not_found"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user UID already exists")


def _create_rgw_user_record(
    payload: CephAdminRgwUserCreate,
    *,
    uid: str,
    tenant: Optional[str],
    account_id: Optional[str],
    ctx: CephAdminContext,
) -> Any:
    try:
        if account_id:
            result = ctx.rgw_admin.create_user_with_account_id(
                uid=uid,
                account_id=account_id,
                display_name=payload.display_name or uid,
                account_root=bool(payload.account_root) if payload.account_root is not None else False,
                email=payload.email,
                generate_key=bool(payload.generate_key),
                extra_params=payload.extra_params or None,
                tenant=tenant,
            )
        else:
            result = ctx.rgw_admin.create_user(
                uid=uid,
                display_name=payload.display_name or uid,
                email=payload.email,
                tenant=tenant,
                generate_key=bool(payload.generate_key),
                extra_params=payload.extra_params or None,
            )
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    if isinstance(result, dict) and result.get("conflict"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user already exists")
    raise_if_unsupported(result, "RGW user creation is not supported on this cluster")
    return result


def _apply_created_user_configuration(
    payload: CephAdminRgwUserCreate,
    *,
    uid: str,
    tenant: Optional[str],
    ctx: CephAdminContext,
) -> set[str]:
    field_set = set(payload.model_fields_set)
    if USER_UPDATE_FIELD_SET & field_set:
        _apply_user_update(
            uid,
            tenant,
            _user_update_params(payload, field_set, clear_nulls=False),
            ctx,
        )
    if payload.caps is not None:
        _apply_caps_update(uid, tenant, payload.caps.mode, payload.caps.values, ctx)
    if any(getattr(payload, field) is not None for field in USER_QUOTA_FIELDS):
        _apply_user_quota_update(
            uid,
            tenant,
            max_size_bytes=payload.quota_max_size_bytes,
            max_objects=payload.quota_max_objects,
            enabled=payload.quota_enabled,
            ctx=ctx,
        )
    return field_set


@router.post("", response_model=CephAdminRgwUserCreateResponse, status_code=status.HTTP_201_CREATED)
def create_rgw_user(
    payload: CephAdminRgwUserCreate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwUserCreateResponse:
    uid, tenant, account_id = _resolve_create_user_scope(payload, ctx)
    _require_create_user_uid_available(uid, tenant, ctx)
    create_result = _create_rgw_user_record(
        payload,
        uid=uid,
        tenant=tenant,
        account_id=account_id,
        ctx=ctx,
    )

    # RGW can resolve the bare UID to another account. Verify the fresh record
    # before any profile, quota, or capability updates and before exposing a key.
    require_user_scope(uid, tenant, account_id, ctx.rgw_admin)
    field_set = _apply_created_user_configuration(
        payload,
        uid=uid,
        tenant=tenant,
        ctx=ctx,
    )

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
            "generate_key": bool(payload.generate_key),
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
    field_set = set(update.model_fields_set)
    if USER_UPDATE_FIELD_SET & field_set or update.extra_params:
        params = _user_update_params(update, field_set, clear_nulls=True)
        params["extra_params"] = update.extra_params or None
        _apply_user_update(uid, tenant, params, ctx)

    if "caps" in field_set and update.caps is not None:
        _apply_caps_update(uid, tenant, update.caps.mode, update.caps.values, ctx)

    if USER_QUOTA_FIELDS & field_set:
        _apply_user_quota_update(
            uid,
            tenant,
            max_size_bytes=nullable_update(
                update.quota_max_size_bytes,
                "quota_max_size_bytes",
                field_set,
                0,
            ),
            max_objects=nullable_update(update.quota_max_objects, "quota_max_objects", field_set, 0),
            enabled=update.quota_enabled if "quota_enabled" in field_set else True,
            ctx=ctx,
        )

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
