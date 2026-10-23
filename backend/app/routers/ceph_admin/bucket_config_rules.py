# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket rule configuration endpoints for Ceph Admin."""

from fastapi import APIRouter, Depends, Response, status

from app.models.bucket import (
    BucketCors,
    BucketCorsUpdate,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketReplicationConfiguration,
    BucketTags,
    BucketTagsUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.ceph_admin.bucket_config_common import (
    _run_bucket_config_read,
    _run_bucket_config_delete,
    _run_bucket_config_update,
)
from app.services.storage_endpoint_feature_guards import require_replication_feature
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services import bucket_config_actions

router = APIRouter()


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_lifecycle_config,
    )


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="lifecycle",
        payload=payload,
    )


@router.delete("/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_lifecycle(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="lifecycle",
    )


@router.get("/{bucket_name}/cors", response_model=BucketCors)
def get_cors(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketCors:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_cors_config,
    )


@router.put("/{bucket_name}/cors", response_model=BucketCors)
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketCors:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="cors",
        payload=payload,
    )


@router.delete("/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_cors(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="cors",
    )


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_notifications_config,
    )


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="notifications",
        payload=payload,
    )


@router.delete("/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notifications(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="notifications",
    )


@router.get("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_replication(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    require_replication_feature(ctx.endpoint)
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_replication_config,
    )


@router.put("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_replication(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    require_replication_feature(ctx.endpoint)
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="replication",
        payload=payload,
    )


@router.delete("/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_replication(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    require_replication_feature(ctx.endpoint)
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="replication",
    )


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_logging_config,
    )


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="logging",
        payload=payload,
    )


@router.delete("/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_logging(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="logging",
    )


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_website_config,
    )


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="website",
        payload=payload,
    )


@router.delete("/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_website(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="website",
    )


@router.get("/{bucket_name}/tags", response_model=BucketTags)
def get_tags(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketTags:
    return _run_bucket_config_read(
        ctx,
        bucket_name,
        tenant=tenant,
        action=bucket_config_actions.get_bucket_tags_config,
    )


@router.put("/{bucket_name}/tags", response_model=BucketTags)
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketTags:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="tags",
        payload=payload,
    )


@router.delete("/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_tags(
    bucket_name: str,
    tenant: str | None = None,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        tenant=tenant,
        config_area="tags",
    )

