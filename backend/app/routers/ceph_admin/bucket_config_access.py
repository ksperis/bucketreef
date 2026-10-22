# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket access configuration endpoints for Ceph Admin."""

from fastapi import APIRouter, Depends, Response, status

from app.models.bucket import (
    BucketAcl,
    BucketAclUpdate,
    BucketPolicyIn,
    BucketPolicyOut,
    BucketPublicAccessBlock,
)
from app.routers.ceph_admin.bucket_config_common import (
    _run_bucket_config_read,
    _run_bucket_config_delete,
    _run_bucket_config_update,
)
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services import bucket_config_actions

router = APIRouter()


@router.get("/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_policy(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_policy_config,
    )


@router.put("/{bucket_name}/policy", response_model=BucketPolicyOut)
def put_policy(
    bucket_name: str,
    payload: BucketPolicyIn,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPolicyOut:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="policy",
        payload=payload,
    )


@router.delete("/{bucket_name}/policy", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_policy(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="policy",
    )


@router.get("/{bucket_name}/acl", response_model=BucketAcl)
def get_acl(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_acl_config,
    )


@router.put("/{bucket_name}/acl", response_model=BucketAcl)
def put_acl(
    bucket_name: str,
    payload: BucketAclUpdate,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketAcl:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="acl",
        payload=payload,
    )


@router.get("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def get_public_access_block(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_public_access_block_config,
    )


@router.put("/{bucket_name}/public-access-block", response_model=BucketPublicAccessBlock)
def put_public_access_block(
    bucket_name: str,
    payload: BucketPublicAccessBlock,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketPublicAccessBlock:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="public_access_block",
        payload=payload,
    )

