# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Bucket rule configuration endpoints for Ceph Admin."""

from fastapi import APIRouter, Depends, Response, status

from app.models.bucket import (
    BucketCorsUpdate,
    BucketLifecycleConfig,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketReplicationConfiguration,
    BucketTagsUpdate,
    BucketWebsiteConfiguration,
)
from app.routers.ceph_admin.bucket_config_common import (
    _run_bucket_config_delete,
    _run_bucket_config_update,
)
from app.services.storage_endpoint_feature_guards import require_replication_feature
from app.routers.ceph_admin.dependencies import (
    get_ceph_admin_context,
)
from app.services.ceph_admin_context import CephAdminContext
from app.services import bucket_config_actions
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.s3_execution_context import build_ceph_admin_s3_context

router = APIRouter()


@router.get("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def get_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_lifecycle_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/lifecycle", response_model=BucketLifecycleConfig)
def put_lifecycle(
    bucket_name: str,
    payload: BucketLifecycleConfig,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLifecycleConfig:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="lifecycle",
        payload=payload,
    )


@router.delete("/{bucket_name}/lifecycle", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_lifecycle(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="lifecycle",
    )


@router.get("/{bucket_name}/cors")
def get_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_cors_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/cors")
def put_cors(
    bucket_name: str,
    payload: BucketCorsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="cors",
        payload=payload,
    )


@router.delete("/{bucket_name}/cors", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_cors(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="cors",
    )


@router.get("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def get_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_notifications_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/notifications", response_model=BucketNotificationConfiguration)
def put_notifications(
    bucket_name: str,
    payload: BucketNotificationConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketNotificationConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="notifications",
        payload=payload,
    )


@router.delete("/{bucket_name}/notifications", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_notifications(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="notifications",
    )


@router.get("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def get_replication(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    require_replication_feature(ctx.endpoint)
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_replication_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/replication", response_model=BucketReplicationConfiguration)
def put_replication(
    bucket_name: str,
    payload: BucketReplicationConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketReplicationConfiguration:
    require_replication_feature(ctx.endpoint)
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="replication",
        payload=payload,
    )


@router.delete("/{bucket_name}/replication", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_replication(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    require_replication_feature(ctx.endpoint)
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="replication",
    )


@router.get("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_logging_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def put_logging(
    bucket_name: str,
    payload: BucketLoggingConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketLoggingConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="logging",
        payload=payload,
    )


@router.delete("/{bucket_name}/logging", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_logging(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="logging",
    )


@router.get("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_website_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def put_website(
    bucket_name: str,
    payload: BucketWebsiteConfiguration,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> BucketWebsiteConfiguration:
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="website",
        payload=payload,
    )


@router.delete("/{bucket_name}/website", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_website(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="website",
    )


@router.get("/{bucket_name}/tags")
def get_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    service = BucketConfigurationService()
    context = build_ceph_admin_s3_context(ctx)
    return bucket_config_actions.get_bucket_tags_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.put("/{bucket_name}/tags")
def put_tags(
    bucket_name: str,
    payload: BucketTagsUpdate,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
):
    return _run_bucket_config_update(
        ctx,
        bucket_name,
        config_area="tags",
        payload=payload,
    )


@router.delete("/{bucket_name}/tags", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_tags(
    bucket_name: str,
    ctx: CephAdminContext = Depends(get_ceph_admin_context),
) -> Response:
    return _run_bucket_config_delete(
        ctx,
        bucket_name,
        config_area="tags",
    )

