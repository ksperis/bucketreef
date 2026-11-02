# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""S3 bucket configuration for the standalone Advanced Browser."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.services.access_context_contracts import ManagerActor, ManagerSessionPrincipal

from app.core.database import get_db
from app.models.bucket import Bucket
from app.routers import bucket_config_inspector
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


router.include_router(
    bucket_config_inspector.router,
    prefix="/buckets/config",
)
router.include_router(
    bucket_config_core.router,
    prefix="/buckets/config",
    dependencies=[Depends(require_advanced_browser_bucket_config)],
)
router.include_router(
    bucket_config_access.router,
    prefix="/buckets/config",
    dependencies=[Depends(require_advanced_browser_bucket_config)],
)
router.include_router(
    bucket_config_rules.router,
    prefix="/buckets/config",
    dependencies=[Depends(require_advanced_browser_bucket_config)],
)
