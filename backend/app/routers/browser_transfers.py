# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.access_context import ManagerActor
from app.models.browser import (
    BrowserStsCredentials,
    CompleteMultipartUploadRequest,
    ListMultipartUploadsResponse,
    MultipartUploadInitRequest,
    MultipartUploadInitResponse,
    ObjectUploadResponse,
    PresignPartRequest,
    PresignPartResponse,
    PresignRequest,
    PresignedUrl,
    SseCustomerContext,
    StsStatus,
)
from app.services.storage_endpoint_feature_guards import require_sse_feature
from app.routers.s3_download_response import S3DownloadResponse
from app.routers.dependencies import (
    get_s3_execution_context,
    get_current_account_admin,
    get_optional_sse_customer_context,
)
from app.services.auth_session_guards import current_auth_session
from app.services.browser_service import BrowserService, get_browser_service
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_bad_gateway_from_runtime

router = APIRouter()


@router.get("/sts", response_model=StsStatus)
def get_sts_status(
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> StsStatus:
    return service.check_sts(context)


@router.get("/sts/credentials", response_model=BrowserStsCredentials)
def get_sts_credentials(
    request: Request,
    response: Response,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    db: Session = Depends(get_db),
    _: ManagerActor = Depends(get_current_account_admin),
) -> BrowserStsCredentials:
    auth_session = current_auth_session(request, db)
    try:
        credentials = service.get_sts_credentials(
            context,
            cache_partition=f"auth-session:{auth_session.id}",
        )
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        return credentials
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/proxy-upload", response_model=ObjectUploadResponse)
def upload_via_proxy(
    bucket_name: str,
    file: UploadFile = File(...),
    key: str = Form(...),
    content_type: Optional[str] = Form(default=None),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectUploadResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        require_sse_feature(context.storage_endpoint)
    try:
        service.upload_via_proxy(
            bucket_name,
            context,
            file,
            key=key,
            content_type=content_type,
            sse_customer=sse_customer,
        )
        return ObjectUploadResponse(message="Upload completed", key=key)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/download")
def download_object(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> StreamingResponse:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        require_sse_feature(context.storage_endpoint)
    try:
        download = service.download_object(
            bucket_name,
            context,
            key,
            version_id=version_id,
            sse_customer=sse_customer,
        )
        return S3DownloadResponse(download)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/presign", response_model=PresignedUrl)
def presign(
    bucket_name: str,
    payload: PresignRequest,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> PresignedUrl:
    if sse_customer:
        require_sse_feature(context.storage_endpoint)
    try:
        return service.presign(bucket_name, context, payload, sse_customer=sse_customer)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post("/buckets/{bucket_name}/multipart/initiate", response_model=MultipartUploadInitResponse)
def multipart_init(
    bucket_name: str,
    payload: MultipartUploadInitRequest,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> MultipartUploadInitResponse:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        require_sse_feature(context.storage_endpoint)
    try:
        return service.initiate_multipart_upload(
            bucket_name,
            context,
            payload,
            sse_customer=sse_customer,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.get("/buckets/{bucket_name}/multipart", response_model=ListMultipartUploadsResponse)
def list_multipart_uploads(
    bucket_name: str,
    prefix: Optional[str] = None,
    key_marker: Optional[str] = None,
    upload_id_marker: Optional[str] = None,
    max_uploads: int = Query(default=1000, ge=1, le=1000),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ListMultipartUploadsResponse:
    try:
        return service.list_multipart_uploads(
            bucket_name,
            context,
            prefix=prefix,
            key_marker=key_marker,
            upload_id_marker=upload_id_marker,
            max_uploads=max_uploads,
        )
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)



@router.post("/buckets/{bucket_name}/multipart/{upload_id}/presign", response_model=PresignPartResponse)
def presign_part_for_upload(
    bucket_name: str,
    upload_id: str,
    payload: PresignPartRequest,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> PresignPartResponse:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    payload.upload_id = upload_id
    if sse_customer:
        require_sse_feature(context.storage_endpoint)
    try:
        return service.presign_part(bucket_name, context, payload, sse_customer=sse_customer)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post(
    "/buckets/{bucket_name}/multipart/{upload_id}/complete",
    status_code=status.HTTP_204_NO_CONTENT,
)
def complete_multipart_upload(
    bucket_name: str,
    upload_id: str,
    key: str,
    payload: CompleteMultipartUploadRequest,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> None:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.complete_multipart_upload(bucket_name, context, key, upload_id, payload)
        return None
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.delete(
    "/buckets/{bucket_name}/multipart/{upload_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def abort_multipart_upload(
    bucket_name: str,
    upload_id: str,
    key: str,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> None:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    try:
        service.abort_multipart_upload(bucket_name, context, key, upload_id)
        return None
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
