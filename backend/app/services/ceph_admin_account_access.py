# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, MutableMapping, Optional

from fastapi import HTTPException, status

from app.db import StorageEndpoint
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.rgw_payloads import extract_rgw_account_name
from app.utils.storage_endpoint_features import resolve_feature_flags


def optional_account_lookup_enabled(endpoint: StorageEndpoint) -> bool | None:
    try:
        return resolve_feature_flags(endpoint).account_enabled
    except ValueError:
        return None


def load_account_payload(
    account_id: str,
    rgw_admin: RGWAdminClient,
) -> dict[str, Any]:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="account_id is required",
        )
    try:
        payload = rgw_admin.get_account(normalized_account_id, allow_not_found=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not payload or (isinstance(payload, dict) and payload.get("not_found")):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="RGW account not found",
        )
    if not isinstance(payload, dict):
        return {"payload": payload}
    return payload


def resolve_optional_account_name(
    account_id: Optional[str],
    payload_account_name: Optional[str],
    rgw_admin: RGWAdminClient,
    *,
    account_lookup_enabled: bool | None,
    cache: MutableMapping[str, Optional[str]] | None = None,
) -> Optional[str]:
    if not account_id:
        return payload_account_name

    if cache is not None and account_id in cache:
        return cache[account_id] or payload_account_name

    account_name = None
    if account_lookup_enabled is not False:
        try:
            account_payload = rgw_admin.get_account(
                account_id,
                allow_not_found=True,
                allow_not_implemented=True,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        if isinstance(account_payload, dict) and not account_payload.get("not_found"):
            account_name = extract_rgw_account_name(account_payload)

    if cache is not None:
        cache[account_id] = account_name
    return account_name or payload_account_name
