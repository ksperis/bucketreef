# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW account route helpers."""

from typing import Any

from fastapi import HTTPException, status

from app.routers.ceph_admin.dependencies import CephAdminContext
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception


def load_account_payload(account_id: str, ctx: CephAdminContext) -> dict[str, Any]:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")
    try:
        payload = ctx.rgw_admin.get_account(normalized_account_id, allow_not_found=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
    if not payload or (isinstance(payload, dict) and payload.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RGW account not found")
    if not isinstance(payload, dict):
        return {"payload": payload}
    return payload
