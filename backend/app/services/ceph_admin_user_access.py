# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException, status

from app.models.ceph_admin import CephAdminRgwAccessKey
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.normalize import normalize_optional_scalar
from app.utils.rgw_payloads import extract_rgw_user_account_ids, extract_rgw_user_identity


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
                status=status_text,
                is_active=is_active,
                created_at=entry.get("create_date") or entry.get("created_at"),
                user=normalize_optional_scalar(entry.get("user") or entry.get("uid")),
                subuser=normalize_optional_scalar(entry.get("subuser")),
            )
        )
    return results


def load_user_payload(
    uid: str,
    tenant: Optional[str],
    rgw_admin: RGWAdminClient,
) -> dict[str, Any]:
    normalized_uid = uid.strip()
    if not normalized_uid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="uid is required")
    try:
        payload = rgw_admin.get_user(
            normalized_uid,
            tenant=tenant,
            allow_not_found=True,
        )
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
    rgw_admin: RGWAdminClient,
) -> dict[str, Any]:
    """Resolve the RGW identity before any user/key mutation, failing closed on drift."""
    payload = load_user_payload(uid, tenant, rgw_admin)
    actual_uid, actual_tenant, account_values = _resolved_user_scope(payload)
    _require_matching_identity(uid, tenant, actual_uid, actual_tenant)
    _require_matching_account(expected_account_id, account_values)
    return payload


def _resolved_user_scope(payload: dict[str, Any]) -> tuple[Optional[str], Optional[str], set[str]]:
    try:
        actual_uid, actual_tenant = extract_rgw_user_identity(payload)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="RGW user identity has changed; refresh the user list",
        ) from exc
    return actual_uid, actual_tenant, extract_rgw_user_account_ids(payload)


def _require_matching_identity(
    uid: str,
    tenant: Optional[str],
    actual_uid: Optional[str],
    actual_tenant: Optional[str],
) -> None:
    if actual_uid != uid or (actual_tenant or None) != (tenant or None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="RGW user identity has changed; refresh the user list",
        )


def _require_matching_account(
    expected_account_id: Optional[str],
    account_values: set[str],
) -> None:
    if expected_account_id:
        if account_values != {expected_account_id}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="RGW user account has changed; refresh the user list",
            )
    elif account_values:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="expected_account_id is required for an account user",
        )


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
