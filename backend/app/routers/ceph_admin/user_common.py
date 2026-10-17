# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared Ceph Admin RGW user payload helpers."""

from typing import Any, Optional

from fastapi import HTTPException, status

from app.models.ceph_admin import CephAdminRgwAccessKey
from app.routers.ceph_admin.dependencies import CephAdminContext
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.rgw_payloads import extract_rgw_user_payload
from app.utils.storage_endpoint_features import resolve_feature_flags


def split_tenant_uid(value: str) -> tuple[Optional[str], str]:
    raw = value.strip()
    if "$" in raw:
        tenant, uid = raw.split("$", 1)
        if tenant and uid:
            return tenant, uid
    return None, raw


def optional_account_lookup_enabled(ctx: CephAdminContext) -> bool | None:
    try:
        return resolve_feature_flags(ctx.endpoint).account_enabled
    except Exception:
        return None


def serialize_access_keys(entries: list[dict]) -> list[CephAdminRgwAccessKey]:
    results: list[CephAdminRgwAccessKey] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        access_key_value = entry.get("access_key") or entry.get("access_key_id")
        access_key = normalize_optional_scalar(access_key_value)
        if not access_key or access_key in seen:
            continue
        seen.add(access_key)
        status_text, is_active = _parse_key_status(
            entry.get("status") or entry.get("key_status") or entry.get("state")
        )
        results.append(
            CephAdminRgwAccessKey(
                access_key=access_key,
                secret_key=normalize_optional_scalar(entry.get("secret_key")),
                status=status_text,
                is_active=is_active,
                created_at=entry.get("create_date") or entry.get("created_at"),
                user=normalize_optional_scalar(entry.get("user") or entry.get("uid")),
                subuser=normalize_optional_scalar(entry.get("subuser")),
            )
        )
    return results


def load_user_payload(uid: str, tenant: Optional[str], ctx: CephAdminContext) -> dict[str, Any]:
    normalized_uid = uid.strip()
    if not normalized_uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    try:
        payload = ctx.rgw_admin.get_user(normalized_uid, tenant=tenant, allow_not_found=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not payload or (isinstance(payload, dict) and payload.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW user not found")
    if not isinstance(payload, dict):
        return {"payload": payload}
    return payload


def require_user_scope(
    uid: str,
    tenant: Optional[str],
    expected_account_id: Optional[str],
    ctx: CephAdminContext,
) -> dict[str, Any]:
    """Resolve the RGW identity before any user/key mutation, failing closed on drift."""
    payload = load_user_payload(uid, tenant, ctx)
    user = extract_rgw_user_payload(payload)
    raw_uid = normalize_optional_scalar(user.get("uid") or user.get("user_id") or payload.get("uid") or payload.get("user_id"))
    actual_tenant = normalize_optional_scalar(user.get("tenant") or payload.get("tenant"))
    if raw_uid and "$" in raw_uid:
        embedded_tenant, raw_uid = split_tenant_uid(raw_uid)
        actual_tenant = actual_tenant or embedded_tenant
    account_values = {
        value for value in (
            normalize_optional_scalar(user.get("account_id")),
            normalize_optional_scalar(payload.get("account_id")),
        ) if value
    }
    if raw_uid != uid or (actual_tenant or None) != (tenant or None):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user identity has changed; refresh the user list")
    if expected_account_id:
        if account_values != {expected_account_id}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="RGW user account has changed; refresh the user list")
    elif account_values:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="expected_account_id is required for an account user")
    return payload


def _parse_key_status(status_value: Any) -> tuple[Optional[str], Optional[bool]]:
    if status_value is None:
        return None, None
    status_text = str(status_value).strip()
    if not status_text:
        return None, None
    normalized = status_text.lower()
    if normalized in {"enabled", "active", "true", "1"}:
        return status_text, True
    if normalized in {"disabled", "inactive", "suspended", "false", "0"}:
        return status_text, False
    return status_text, None
