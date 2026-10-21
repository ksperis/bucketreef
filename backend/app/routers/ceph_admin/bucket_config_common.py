# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared execution helpers for Ceph Admin bucket configuration."""

from typing import Any, Literal

from fastapi import Response

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
from app.services.s3_execution_context import S3ExecutionContext, build_ceph_admin_s3_context


def _record_bucket_config_mutation(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: str,
    operation: Literal["update", "delete"],
    metadata: dict[str, Any] | None = None,
) -> None:
    invalidate_bucket_listing_cache(ctx.endpoint.id)
    record_ceph_admin_action(
        ctx,
        action=f"bucket_config.{config_area}.{operation}",
        entity_type="bucket",
        entity_id=bucket_name,
        metadata=bucket_config_actions.bucket_config_audit_metadata(
            config_area=config_area,
            operation=operation,
            metadata=metadata,
        ),
    )


def _ceph_admin_bucket_config_context(ctx: CephAdminContext) -> tuple[BucketConfigurationService, S3ExecutionContext]:
    return BucketConfigurationService(), build_ceph_admin_s3_context(ctx)


def _run_bucket_config_update(
    ctx: CephAdminContext,
    bucket_name: str,
    *,
    config_area: BucketConfigArea,
    **kwargs: Any,
) -> Any:
    service, context = _ceph_admin_bucket_config_context(ctx)
    mutation = get_bucket_config_mutation(config_area)
    return bucket_config_actions.apply_bucket_config_update(
        service=service,
        context=context,
        bucket_name=bucket_name,
        action=mutation.update_action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
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
    config_area: BucketConfigArea,
) -> Response:
    service, context = _ceph_admin_bucket_config_context(ctx)
    mutation = get_bucket_config_delete_mutation(config_area)
    assert mutation.delete_action is not None
    return bucket_config_actions.apply_bucket_config_delete(
        service=service,
        context=context,
        bucket_name=bucket_name,
        action=mutation.delete_action,
        audit_recorder=lambda metadata: _record_bucket_config_mutation(
            ctx,
            bucket_name,
            config_area=config_area,
            operation="delete",
            metadata=metadata,
        ),
    )

