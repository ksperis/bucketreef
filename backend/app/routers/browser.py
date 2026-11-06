# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""User-facing S3 browser endpoints.

These endpoints back the `/browser` surface.

They are credential-first and can be used with:
- RGW accounts (account-centric) for members with bucket permissions
- S3 users (when explicitly linked)
- User-scoped S3 connections (selector `conn-<id>`)
- Ceph Admin endpoint context (selector `ceph-admin-<endpoint_id>`)

The endpoints reuse the `context_id` selector and context resolution
logic implemented in :func:`app.routers.dependencies.get_s3_execution_context`.
"""

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.access_context_contracts import ManagerActor
from app.models.app_settings import BrowserSettings
from app.models.bucket import BucketVersioningStatus
from app.models.browser import (
    BrowserBucketSearchRequest,
    BrowserObjectListingRequest,
    BrowserUsageSummary,
    BucketCorsStatus,
    CreateBucketPayload,
    EnsureCorsPayload,
    ListBrowserObjectsResponse,
    ObjectColumnsRequest,
    ObjectColumnsResponse,
    PaginatedBrowserBucketsResponse,
    SseCustomerContext,
)
from app.routers import browser_bucket_config, browser_objects, browser_transfers, browser_transfer_policy
from app.routers.dependencies import (
    get_s3_execution_context,
    get_audit_service,
    get_current_account_admin,
    get_optional_sse_customer_context,
    require_portal_browser_basic_route,
    require_browser_workspace_surface,
)
from app.services.app_settings_service import load_app_settings_for_db
from app.services.audit_service import AuditService
from app.services.browser_service import BrowserService, get_browser_service
from app.services.browser_usage_summary_service import (
    BrowserUsageSummaryService,
    get_browser_usage_summary_service,
)
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_bad_gateway_from_runtime

router = APIRouter(
    prefix="/browser",
    tags=["browser"],
    dependencies=[
        Depends(require_portal_browser_basic_route),
        Depends(require_browser_workspace_surface),
    ],
)
router.include_router(browser_bucket_config.router)
router.include_router(browser_objects.router)
router.include_router(browser_transfers.router)
router.include_router(browser_transfer_policy.router)


@router.get("/settings", response_model=BrowserSettings)
def get_browser_settings(
    _: ManagerActor = Depends(get_current_account_admin),
    db: Session = Depends(get_db),
) -> BrowserSettings:
    return load_app_settings_for_db(db).browser


def get_browser_usage_service(db: Session = Depends(get_db)) -> BrowserUsageSummaryService:
    return get_browser_usage_summary_service(db)


@router.get(
    "/buckets/search",
    response_model=PaginatedBrowserBucketsResponse,
    response_model_exclude_none=True,
)
def search_buckets(
    query: Annotated[BrowserBucketSearchRequest, Depends()],
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> PaginatedBrowserBucketsResponse:
    try:
        return service.search_buckets(context, query)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get(
    "/usage-summary",
    response_model=BrowserUsageSummary,
)
def get_usage_summary(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserUsageSummaryService = Depends(get_browser_usage_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BrowserUsageSummary:
    return service.build(context)


@router.post("/buckets", status_code=status.HTTP_201_CREATED, response_class=Response)
def create_bucket(
    payload: CreateBucketPayload,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    actor: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> Response:
    bucket_name = payload.name.strip()
    if not bucket_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bucket name is required")
    try:
        service.create_bucket(bucket_name, context, versioning=payload.versioning)
        audit_service.record_action(
            user=actor,
            scope="browser",
            action="create_bucket",
            entity_type="bucket",
            entity_id=bucket_name,
            execution_context=context,
            metadata={"versioning": payload.versioning},
        )
        return Response(status_code=status.HTTP_201_CREATED)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/versioning", response_model=BucketVersioningStatus)
def get_bucket_versioning(
    bucket_name: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketVersioningStatus:
    try:
        status_value = service.get_bucket_versioning(bucket_name, context)
        enabled = status_value == "Enabled"
        return BucketVersioningStatus(status=status_value, enabled=enabled)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/objects", response_model=ListBrowserObjectsResponse)
def list_objects(
    bucket_name: str,
    query: Annotated[BrowserObjectListingRequest, Depends()],
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ListBrowserObjectsResponse:
    try:
        return service.list_objects(
            bucket_name,
            context,
            query,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/objects/columns", response_model=ObjectColumnsResponse)
def get_object_columns(
    bucket_name: str,
    payload: ObjectColumnsRequest,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectColumnsResponse:
    try:
        return service.get_object_columns(
            bucket_name,
            context,
            keys=payload.keys,
            columns=set(payload.columns),
            sse_customer=sse_customer,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/cors", response_model=BucketCorsStatus)
def get_bucket_cors(
    bucket_name: str,
    origin: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BucketCorsStatus:
    return service.get_bucket_cors_status(bucket_name, context, origin=origin)


@router.post("/buckets/{bucket_name}/cors/ensure", response_model=BucketCorsStatus)
def ensure_bucket_cors(
    bucket_name: str,
    payload: EnsureCorsPayload,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    actor: ManagerActor = Depends(get_current_account_admin),
    audit_service: AuditService = Depends(get_audit_service),
) -> BucketCorsStatus:
    if not payload.origin:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing origin")
    try:
        status_result = service.ensure_bucket_cors(bucket_name, context, payload.origin)
        audit_service.record_action(
            user=actor,
            scope="browser",
            action="ensure_bucket_cors",
            entity_type="bucket",
            entity_id=bucket_name,
            execution_context=context,
            metadata={"origin": payload.origin},
        )
        return status_result
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
