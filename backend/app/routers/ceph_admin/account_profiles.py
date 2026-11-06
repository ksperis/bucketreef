# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Ceph Admin RGW account creation, profile, configuration, and metrics routes."""

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ceph_admin import (
    CephAdminEntityMetrics,
    CephAdminRgwAccountConfigUpdate,
    CephAdminRgwAccountCreate,
    CephAdminRgwAccountCreateResponse,
    CephAdminRgwAccountDetail,
)
from app.services.ceph_admin_account_access import load_account_payload
from app.services.ceph_admin_account_profile_service import CephAdminAccountProfileMutationService
from app.services.ceph_admin_account_payloads import (
    build_account_detail,
    extract_account_bucket_list,
)
from app.routers.ceph_admin.dependencies import get_ceph_admin_context
from app.routers.ceph_admin.profile_common import raise_profile_service_error
from app.services.ceph_admin_context import CephAdminContext
from app.services.ceph_admin_profile_mutations import CephAdminProfileServiceError
from app.services.app_settings_service import load_app_settings_for_db
from app.services.ceph_admin_identity_listing_cache import invalidate_accounts_listing_cache
from app.services.ceph_admin_audit import record_ceph_admin_action
from app.services.rgw_admin import RGWAdminError
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.rgw_identifiers import generate_rgw_account_id
from app.utils.usage_stats import summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/accounts", tags=["ceph-admin-accounts"])

@router.post("", response_model=CephAdminRgwAccountCreateResponse, status_code=status.HTTP_201_CREATED)
def create_rgw_account(
    payload: CephAdminRgwAccountCreate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
    db: Session = Depends(get_db),
) -> CephAdminRgwAccountCreateResponse:
    requested_account_id = payload.account_id.strip() if isinstance(payload.account_id, str) else None
    requested_account_id = requested_account_id or None
    if requested_account_id is None:
        requested_account_id = generate_rgw_account_id(
            load_app_settings_for_db(db).general.rgw_account_id_prefix
        )
    account_name = payload.account_name.strip()
    account_id = requested_account_id
    mutations = CephAdminAccountProfileMutationService(ctx.rgw_admin)
    try:
        mutations.create_account(
            payload,
            account_id=account_id,
            account_name=account_name,
        )
        account_quota_updated, bucket_quota_updated = mutations.apply_created_quotas(
            payload,
            account_id=account_id,
        )
    except CephAdminProfileServiceError as exc:
        raise_profile_service_error(exc)

    invalidate_accounts_listing_cache(ctx.endpoint.id)
    account_detail = build_account_detail(
        load_account_payload(account_id, ctx.rgw_admin),
        account_id_fallback=account_id,
    )
    record_ceph_admin_action(
        ctx,
        action="rgw_account.create",
        entity_type="rgw_account",
        entity_id=account_id,
        metadata={
            "requested_account_id": requested_account_id,
            "quota_updated": account_quota_updated,
            "bucket_quota_updated": bucket_quota_updated,
        },
    )
    return CephAdminRgwAccountCreateResponse(account=account_detail)


@router.get("/{account_id}/detail", response_model=CephAdminRgwAccountDetail)
def get_rgw_account_detail(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountDetail:
    return build_account_detail(
        load_account_payload(account_id, ctx.rgw_admin),
        account_id_fallback=account_id.strip(),
    )


@router.patch("/{account_id}/config", response_model=CephAdminRgwAccountDetail)
def update_rgw_account_config(
    account_id: str,
    update: CephAdminRgwAccountConfigUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminRgwAccountDetail:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")

    mutations = CephAdminAccountProfileMutationService(ctx.rgw_admin)
    try:
        field_set = mutations.apply_updated_configuration(
            update,
            account_id=normalized_account_id,
        )
    except CephAdminProfileServiceError as exc:
        raise_profile_service_error(exc)

    invalidate_accounts_listing_cache(ctx.endpoint.id)
    payload = load_account_payload(normalized_account_id, ctx.rgw_admin)
    record_ceph_admin_action(
        ctx,
        action="rgw_account.update",
        entity_type="rgw_account",
        entity_id=normalized_account_id,
        metadata={"fields": sorted(field_set)},
    )
    return build_account_detail(payload, account_id_fallback=normalized_account_id)


@router.get("/{account_id}/metrics", response_model=CephAdminEntityMetrics)
def get_rgw_account_metrics(
    account_id: str,
    root_uid: Optional[str] = None,
    tenant: Optional[str] = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> CephAdminEntityMetrics:
    normalized_account_id = account_id.strip()
    if not normalized_account_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="account_id is required")
    try:
        normalized_root_uid = (root_uid or "").strip()
        if normalized_root_uid:
            payload = ctx.rgw_admin.get_all_buckets(
                uid=normalized_root_uid,
                with_stats=True,
                tenant=tenant,
            )
        else:
            payload = ctx.rgw_admin.get_all_buckets(with_stats=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    bucket_usage, total_bytes, total_objects, bucket_count = summarize_bucket_usage(
        extract_account_bucket_list(payload, normalized_account_id)
    )
    bucket_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)
    return CephAdminEntityMetrics(
        total_bytes=total_bytes,
        total_objects=total_objects,
        bucket_count=bucket_count,
        bucket_usage=bucket_usage,
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )


@router.get("/{account_id}")
def get_rgw_account(
    account_id: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> dict[str, Any]:
    return load_account_payload(account_id, ctx.rgw_admin)
