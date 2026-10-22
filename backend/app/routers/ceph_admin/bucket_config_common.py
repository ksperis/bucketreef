# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared execution helpers for Ceph Admin bucket configuration."""

from typing import Any, Literal

from fastapi import HTTPException, Response, status

from app.services.ceph_admin_context import CephAdminContext
from app.services import bucket_config_actions
from app.services.bucket_config_mutation_registry import (
    BucketConfigArea,
    get_bucket_config_delete_mutation,
    get_bucket_config_mutation,
)
from app.services.ceph_admin_audit import record_ceph_admin_action
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.ceph_admin_bucket_listing_cache import invalidate_bucket_listing_cache
from app.services.rgw_bucket_target import RgwBucketTarget
from app.services.s3_execution_context import S3ExecutionContext, build_ceph_admin_s3_context
from app.utils.rgw_identifiers import validate_rgw_tenant


def normalize_ceph_admin_bucket_tenant(tenant: str | None) -> str | None:
    normalized = (tenant or "").strip()
    if not normalized:
        return None
    try:
        return validate_rgw_tenant(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid RGW tenant.",
        ) from exc


def ceph_admin_bucket_target(
    ctx: CephAdminContext,
    bucket_name: str,
    tenant: str | None,
) -> RgwBucketTarget:
    try:
        return RgwBucketTarget.create(ctx.endpoint.id, tenant, bucket_name)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid RGW bucket reference.",
        ) from exc


def ceph_admin_bucket_entity_id(bucket_name: str, tenant: str | None) -> str:
    normalized_tenant = normalize_ceph_admin_bucket_tenant(tenant)
    return f"{normalized_tenant}/{bucket_name}" if normalized_tenant else bucket_name


def _record_bucket_config_mutation(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    tenant: str | None = None,
    config_area: str,
    operation: Literal["update", "delete"],
    metadata: dict[str, Any] | None = None,
) -> None:
    invalidate_bucket_listing_cache(ctx.endpoint.id)
    record_ceph_admin_action(
        ctx,
        action=f"bucket_config.{config_area}.{operation}",
        entity_type="bucket",
        entity_id=ceph_admin_bucket_entity_id(bucket_name, tenant),
        metadata=bucket_config_actions.bucket_config_audit_metadata(
            config_area=config_area,
            operation=operation,
            metadata=metadata,
        ),
    )


def _ceph_admin_bucket_config_context(
    ctx: CephAdminContext,
) -> tuple[BucketConfigurationService, S3ExecutionContext]:
    return (
        BucketConfigurationService(),
        build_ceph_admin_s3_context(ctx),
    )


def _run_bucket_config_read(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    tenant: str | None = None,
    action,
) -> Any:
    target = ceph_admin_bucket_target(ctx, bucket_name, tenant)
    service, context = _ceph_admin_bucket_config_context(ctx)
    return action(
        service=service,
        context=context,
        bucket_name=target.s3_name,
    )


def _run_bucket_config_update(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    tenant: str | None = None,
    config_area: BucketConfigArea,
    **kwargs: Any,
) -> Any:
    target = ceph_admin_bucket_target(ctx, bucket_name, tenant)
    service, context = _ceph_admin_bucket_config_context(ctx)
    mutation = get_bucket_config_mutation(config_area)
    return bucket_config_actions.apply_bucket_config_update(
        service=service,
        context=context,
        bucket_name=target.s3_name,
        action=mutation.update_action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            tenant=tenant,
            config_area=config_area,
            operation="update",
            metadata=metadata,
        ),
        **kwargs,
    )


def _run_bucket_config_delete(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    tenant: str | None = None,
    config_area: BucketConfigArea,
) -> Response:
    target = ceph_admin_bucket_target(ctx, bucket_name, tenant)
    service, context = _ceph_admin_bucket_config_context(ctx)
    mutation = get_bucket_config_delete_mutation(config_area)
    assert mutation.delete_action is not None
    return bucket_config_actions.apply_bucket_config_delete(
        service=service,
        context=context,
        bucket_name=target.s3_name,
        action=mutation.delete_action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            tenant=tenant,
            config_area=config_area,
            operation="delete",
            metadata=metadata,
        ),
    )

