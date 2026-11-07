# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared dependencies for Manager bucket configuration routes."""

from typing import Any

from fastapi import Depends, Request, Response

from app.core.config import get_settings
from app.routers.bucket_config_errors import run_bucket_config_action, run_bucket_config_no_content
from app.services.access_context_contracts import ManagerActor
from app.utils.request_paths import path_matches_prefix

from app.routers.dependencies import get_audit_service
from app.services.audit_service import AuditService
from app.services.bucket_config_mutation_registry import BucketConfigArea
from app.services.bucket_config_mutation_service import BucketConfigMutationService
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.bucket_listing_cache import invalidate_bucket_listing_cache_for_context
from app.services.s3_execution_context import S3ExecutionContext


def _invalidate_manager_bucket_config_cache(
    context: S3ExecutionContext,
    _bucket_name: str,
) -> None:
    invalidate_bucket_listing_cache_for_context(context)


def get_manager_bucket_config_mutation_service(
    request: Request,
    configuration_service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketConfigMutationService:
    return BucketConfigMutationService(
        configuration_service=configuration_service,
        audit_service=audit_service,
        audit_scope=(
            "browser"
            if path_matches_prefix(
                request.url.path, f"{get_settings().api_prefix}/browser/buckets/config"
            )
            else "manager"
        ),
        cache_invalidator=_invalidate_manager_bucket_config_cache,
    )


def run_manager_bucket_config_update(
    mutation: BucketConfigMutationService,
    actor: ManagerActor,
    context: S3ExecutionContext,
    bucket_name: str,
    config_area: BucketConfigArea,
    payload: Any,
) -> Any:
    return run_bucket_config_action(
        mutation.update,
        actor=actor,
        context=context,
        bucket_name=bucket_name,
        config_area=config_area,
        payload=payload,
    )


def run_manager_bucket_config_delete(
    mutation: BucketConfigMutationService,
    actor: ManagerActor,
    context: S3ExecutionContext,
    bucket_name: str,
    config_area: BucketConfigArea,
) -> Response:
    return run_bucket_config_no_content(
        mutation.delete,
        actor=actor,
        context=context,
        bucket_name=bucket_name,
        config_area=config_area,
    )
