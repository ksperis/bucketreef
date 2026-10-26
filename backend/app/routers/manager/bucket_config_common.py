# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Shared dependencies for Manager bucket configuration routes."""

from fastapi import Depends, Request

from app.core.config import get_settings
from app.utils.request_paths import path_matches_prefix

from app.routers.dependencies import get_audit_service
from app.services.audit_service import AuditService
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
