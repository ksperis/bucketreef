# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""S3 bucket configuration for the standalone Advanced Browser."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.models.access_context import ManagerActor
from app.models.session import ManagerSessionPrincipal
from app.core.database import get_db
from app.models.bucket import (
    Bucket,
    BucketLoggingConfiguration,
    BucketPolicyOut,
    BucketProperties,
    BucketWebsiteConfiguration,
)
from app.routers.dependencies import get_s3_execution_context, get_current_account_admin
from app.routers.dependencies_internal.auth_session import get_current_actor
from app.routers.dependencies_internal.portal_access import is_portal_browser_request
from app.routers.dependencies_internal.execution_context import resolve_workspace_surface
from app.routers.manager import (
    bucket_config_access,
    bucket_config_core,
    bucket_config_rules,
)
from app.services import bucket_config_actions
from app.services.effective_access_service import EffectiveAccessService
from app.services.bucket_configuration_service import (
    BucketConfigurationService,
    get_bucket_configuration_service,
)
from app.services.buckets_service import BucketsService, get_buckets_service
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter()


def require_advanced_browser_bucket_config(
    request: Request,
    actor: ManagerActor = Depends(get_current_actor),
    db: Session = Depends(get_db),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
) -> None:
    """Protect every Advanced-only S3 configuration operation at the API boundary."""
    surface = resolve_workspace_surface(request)
    if surface != "browser" or is_portal_browser_request(request, surface):
        raise HTTPException(status_code=403, detail="Advanced Browser bucket settings are unavailable")
    if isinstance(actor, ManagerSessionPrincipal):
        if not actor.capabilities.access_browser:
            raise HTTPException(status_code=403, detail="Browser access is not allowed for this session")
    elif not EffectiveAccessService(db).resolve_user(actor).browser_advanced_features_enabled:
        raise HTTPException(status_code=403, detail="Advanced Browser features are disabled")
    # The Browser must execute with its selected private connection or with the
    # logged-in S3 session. Never reuse Ceph Admin, Portal, or Manager identities.
    expected_kind = "session" if isinstance(actor, ManagerSessionPrincipal) else "connection"
    if context.context_kind != expected_kind:
        raise HTTPException(status_code=403, detail="Bucket settings require a Browser storage identity")


@router.get("/buckets/config/{bucket_name}/stats", response_model=Bucket)
def get_bucket_config_stats(
    bucket_name: str,
    with_stats: bool = Query(True, description="Include usage/quota stats when available"),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketsService = Depends(get_buckets_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> Bucket:
    return bucket_config_actions.get_bucket_config_stats(
        service=service,
        context=context,
        bucket_name=bucket_name,
        with_stats=with_stats,
    )


@router.get("/buckets/config/{bucket_name}/properties", response_model=BucketProperties)
def get_bucket_properties_config(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketProperties:
    return bucket_config_actions.get_bucket_properties_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.get("/buckets/config/{bucket_name}/policy", response_model=BucketPolicyOut)
def get_bucket_policy_config(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketPolicyOut:
    return bucket_config_actions.get_bucket_policy_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.get("/buckets/config/{bucket_name}/logging", response_model=BucketLoggingConfiguration)
def get_bucket_logging_config(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketLoggingConfiguration:
    return bucket_config_actions.get_bucket_logging_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


@router.get("/buckets/config/{bucket_name}/website", response_model=BucketWebsiteConfiguration)
def get_bucket_website_config(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BucketConfigurationService = Depends(get_bucket_configuration_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketWebsiteConfiguration:
    return bucket_config_actions.get_bucket_website_config(
        service=service,
        context=context,
        bucket_name=bucket_name,
    )


# Reuse the same validated S3 handlers and models as Manager. Keep the five
# inspector reads above available to existing read-only consumers. All additional
# operations require the Advanced profile and resolve a Browser-scoped identity.
_inspector_reads = {"properties", "policy", "logging", "website"}
_advanced_routes = APIRouter()
for _feature_router in (
    bucket_config_core.router,
    bucket_config_access.router,
    bucket_config_rules.router,
):
    for _route in _feature_router.routes:
        if not isinstance(_route, APIRoute):
            continue
        if _route.methods == {"GET"} and _route.path.rsplit("/", 1)[-1] in _inspector_reads:
            continue
        _advanced_routes.routes.append(_route)

router.include_router(
    _advanced_routes,
    prefix="/buckets/config",
    dependencies=[Depends(require_advanced_browser_bucket_config)],
)
