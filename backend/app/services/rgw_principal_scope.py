# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import S3Account, S3User
from app.services.rgw_admin import RGWAdminClient
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.rgw_payloads import extract_rgw_user_identity


def resolve_target_tenant(target: S3Account | S3User | S3ExecutionContext) -> str:
    """Use Runtime Read Ops for legacy discovery, even in Supervision collectors."""
    if target.rgw_tenant is not None:
        return target.rgw_tenant
    from app.services.rgw_endpoint_clients import get_endpoint_runtime_rgw_client
    if target.storage_endpoint is None:
        raise ValueError("RGW principal tenant could not be verified without an endpoint")
    return resolve_principal_tenant(target, get_endpoint_runtime_rgw_client(target.storage_endpoint))


def resolve_principal_tenant(target: S3Account | S3User | S3ExecutionContext, admin: RGWAdminClient) -> str:
    """Resolve old NULL tenants through an account ID or credential lookup, never a bare UID.

    Read clients can omit keys from user-info. The access-key lookup itself is
    authoritative; mutation services separately verify ownership of the stored key.
    This helper does not persist changes during a read.
    """
    if target.rgw_tenant is not None:
        return target.rgw_tenant
    account_id = target.rgw_account_id if hasattr(target, "rgw_account_id") else None
    if account_id:
        payload = admin.get_account(account_id, allow_not_found=True)
        if not payload or payload.get("not_found"):
            raise ValueError("RGW account tenant could not be verified")
        info = payload.get("account") if isinstance(payload.get("account"), dict) else payload
        if info.get("id", info.get("account_id", account_id)) != account_id:
            raise ValueError("RGW returned another account")
        return str(info.get("tenant") or "")
    access_key = getattr(target, "rgw_access_key", None) or getattr(target, "access_key", None)
    if not access_key:
        raise ValueError("RGW principal tenant could not be verified")
    payload = admin.get_user_by_access_key(access_key, allow_not_found=True)
    uid, tenant = extract_rgw_user_identity(payload)
    if not uid or uid != target.rgw_user_uid:
        raise ValueError("Legacy RGW identity is unverified; cannot use Admin Ops")
    return tenant or ""
