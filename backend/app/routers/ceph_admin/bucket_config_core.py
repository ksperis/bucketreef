# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Core and data-protection bucket configuration for Ceph Admin."""

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.models.bucket import (
    BucketEncryptionConfiguration,
    BucketObjectLock,
    BucketObjectLockUpdate,
    BucketProperties,
    BucketQuotaUpdate,
    BucketVersioningStatus,
    BucketVersioningUpdate,
)
from app.services.ceph_admin_audit import record_ceph_admin_action
from app.routers.ceph_admin.bucket_config_common import (
    _run_bucket_config_delete,
    _run_bucket_config_update,
)
from app.services.storage_endpoint_feature_guards import require_sse_feature
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services import bucket_config_actions
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.ceph_admin_bucket_listing_cache import invalidate_bucket_listing_cache
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_bucket_metadata import resolve_bucket_owner_identity
from app.services.s3_execution_context import build_ceph_admin_s3_context
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_bad_request_from_value_error

router = APIRouter()


@router.get("/{bucket_name}/properties", response_model=BucketProperties)
def bucket_properties(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketProperties:
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_properties_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.get("/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_versioning(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketVersioningStatus:
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_versioning_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/versioning", status_code=status.HTTP_200_OK)
def update_versioning(
    bucket_name: str,
    payload: BucketVersioningUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="versioning",
        payload=payload,
    )


@router.put("/{bucket_name}/quota", status_code=status.HTTP_200_OK)
def update_quota(
    bucket_name: str,
    payload: BucketQuotaUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    try:
        bucket_info = ctx.rgw_admin.get_bucket_info(bucket_name, stats=False, allow_not_found=True)
    except RGWAdminError as exc:
        raise_bad_gateway_from_runtime(exc)
    if not bucket_info or (isinstance(bucket_info, dict) and bucket_info.get("not_found")):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bucket not found")

    owner_account_id, owner_uid = resolve_bucket_owner_identity(bucket_info)
    if not owner_account_id and not owner_uid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to resolve bucket owner for quota update",
        )
    context.rgw_account_id = owner_account_id
    context.rgw_user_uid = owner_uid

    try:
        service.set_bucket_quota(bucket_name, context, payload, rgw_admin=ctx.rgw_admin)
        invalidate_bucket_listing_cache(ctx.endpoint.id)
        record_ceph_admin_action(
            ctx,
            action="bucket_quota.update",
            entity_type="bucket",
            entity_id=bucket_name,
            metadata=bucket_config_actions.bucket_config_audit_metadata(
                config_area="quota",
                operation="update",
                metadata={
                    "owner_account_id": owner_account_id,
                    "owner_uid": owner_uid,
                    "quota": payload.model_dump(exclude_none=True),
                },
            ),
        )
        return {"message": "Bucket quota updated"}
    except ValueError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def get_object_lock(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_object_lock_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/object-lock", response_model=BucketObjectLock)
def put_object_lock(
    bucket_name: str,
    payload: BucketObjectLockUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketObjectLock:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="object_lock",
        payload=payload,
    )


@router.get("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def get_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    require_sse_feature(ctx.endpoint)
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_encryption_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/encryption", response_model=BucketEncryptionConfiguration)
def put_bucket_encryption(
    bucket_name: str,
    payload: BucketEncryptionConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketEncryptionConfiguration:
    require_sse_feature(ctx.endpoint)
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="encryption",
        payload=payload,
    )


@router.delete("/{bucket_name}/encryption", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_bucket_encryption(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    require_sse_feature(ctx.endpoint)
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="encryption",
    )
