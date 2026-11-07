# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from typing import Annotated, Any, Optional, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.domain_errors import BrowserStorageSpacePermissionError
from app.services.access_context_contracts import ManagerActor
from app.models.browser import (
    CleanupObjectVersionsPayload,
    CleanupObjectVersionsResponse,
    CopyObjectPayload,
    CreateFolderPayload,
    DeleteObjectsPayload,
    DeleteObjectsResponse,
    ListObjectVersionsResponse,
    ObjectAcl,
    ObjectAclUpdate,
    ObjectLegalHold,
    ObjectLegalHoldUpdate,
    ObjectMetadata,
    ObjectMetadataUpdate,
    ObjectRestoreRequest,
    ObjectRetention,
    ObjectRetentionUpdate,
    ObjectTags,
    ObjectTagsUpdate,
    SseCustomerContext,
)
from app.routers.storage_endpoint_feature_guards import require_sse_feature
from app.routers.dependencies import (
    get_s3_execution_context,
    get_current_account_admin,
    get_optional_sse_customer_context,
)
from app.services.browser_service import BrowserService, get_browser_service
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_http_exception_from_exception

router = APIRouter()

_ObjectActionResult = TypeVar("_ObjectActionResult")


def _run_object_action(
    action: Callable[..., _ObjectActionResult],
    /,
    *args: Any,
    **kwargs: Any,
) -> _ObjectActionResult:
    try:
        return action(*args, **kwargs)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


def _read_object_detail(
    *,
    bucket_name: str,
    key: str,
    version_id: Optional[str],
    context: S3ExecutionContext,
    getter: Callable[..., _ObjectActionResult],
) -> _ObjectActionResult:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    return _run_object_action(getter, bucket_name, context, key, version_id=version_id)


@router.get("/buckets/{bucket_name}/versions", response_model=ListObjectVersionsResponse)
def list_versions(
    bucket_name: str,
    prefix: str = "",
    delimiter: Optional[str] = None,
    key: Annotated[Optional[str], Query(min_length=1)] = None,
    key_marker: Optional[str] = None,
    version_id_marker: Optional[str] = None,
    max_keys: int = Query(default=1000, ge=1, le=1000),
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ListObjectVersionsResponse:
    return _run_object_action(
        service.list_object_versions,
        bucket_name,
        context,
        prefix=prefix,
        delimiter=delimiter,
        key=key,
        key_marker=key_marker,
        version_id_marker=version_id_marker,
        max_keys=max_keys,
    )


@router.get("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def head_object(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    sse_customer: Optional[SseCustomerContext] = Depends(get_optional_sse_customer_context),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectMetadata:
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    if sse_customer:
        require_sse_feature(context.storage_endpoint)
    return _run_object_action(
        service.head_object,
        bucket_name,
        context,
        key,
        version_id=version_id,
        sse_customer=sse_customer,
    )


@router.put("/buckets/{bucket_name}/object-meta", response_model=ObjectMetadata)
def update_object_metadata(
    bucket_name: str,
    payload: ObjectMetadataUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectMetadata:
    return _run_object_action(service.update_object_metadata, bucket_name, context, payload)


@router.get("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def get_object_tags(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectTags:
    return _read_object_detail(
        bucket_name=bucket_name,
        key=key,
        version_id=version_id,
        context=context,
        getter=service.get_object_tags,
    )


@router.put("/buckets/{bucket_name}/object-tags", response_model=ObjectTags)
def put_object_tags(
    bucket_name: str,
    payload: ObjectTagsUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectTags:
    if not payload.key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing key")
    return _run_object_action(
        service.put_object_tags,
        bucket_name,
        context,
        payload.key,
        payload.tags,
        version_id=payload.version_id,
    )


@router.get("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def get_object_acl(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectAcl:
    return _read_object_detail(
        bucket_name=bucket_name,
        key=key,
        version_id=version_id,
        context=context,
        getter=service.get_object_acl,
    )


@router.put("/buckets/{bucket_name}/object-acl", response_model=ObjectAcl)
def put_object_acl(
    bucket_name: str,
    payload: ObjectAclUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectAcl:
    return _run_object_action(service.put_object_acl, bucket_name, context, payload)


@router.get("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def get_object_legal_hold(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectLegalHold:
    return _read_object_detail(
        bucket_name=bucket_name,
        key=key,
        version_id=version_id,
        context=context,
        getter=service.get_object_legal_hold,
    )


@router.put("/buckets/{bucket_name}/object-legal-hold", response_model=ObjectLegalHold)
def put_object_legal_hold(
    bucket_name: str,
    payload: ObjectLegalHoldUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectLegalHold:
    return _run_object_action(service.put_object_legal_hold, bucket_name, context, payload)


@router.get("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def get_object_retention(
    bucket_name: str,
    key: str,
    version_id: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectRetention:
    return _read_object_detail(
        bucket_name=bucket_name,
        key=key,
        version_id=version_id,
        context=context,
        getter=service.get_object_retention,
    )


@router.put("/buckets/{bucket_name}/object-retention", response_model=ObjectRetention)
def put_object_retention(
    bucket_name: str,
    payload: ObjectRetentionUpdate,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> ObjectRetention:
    return _run_object_action(service.put_object_retention, bucket_name, context, payload)


@router.post("/buckets/{bucket_name}/delete", response_model=DeleteObjectsResponse)
def delete_objects(
    bucket_name: str,
    payload: DeleteObjectsPayload,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> DeleteObjectsResponse:
    if not payload.objects:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing objects")
    deleted = _run_object_action(service.delete_objects, bucket_name, context, payload)
    return DeleteObjectsResponse(deleted=deleted)


@router.post(
    "/buckets/{bucket_name}/copy",
    status_code=status.HTTP_204_NO_CONTENT,
)
def copy_object(
    bucket_name: str,
    payload: CopyObjectPayload,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> None:
    if not payload.source_key or not payload.destination_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing source or destination key",
        )
    try:
        service.copy_object(bucket_name, context, payload)
        return None
    except BrowserStorageSpacePermissionError as exc:
        raise_http_exception_from_exception(status.HTTP_403_FORBIDDEN, exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


@router.post(
    "/buckets/{bucket_name}/folders",
    status_code=status.HTTP_204_NO_CONTENT,
)
def create_folder(
    bucket_name: str,
    payload: CreateFolderPayload,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> None:
    if not payload.prefix:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing prefix")
    _run_object_action(service.create_folder, bucket_name, context, payload.prefix)
    return None


@router.post(
    "/buckets/{bucket_name}/object-restore",
    status_code=status.HTTP_204_NO_CONTENT,
)
def restore_object(
    bucket_name: str,
    payload: ObjectRestoreRequest,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> None:
    _run_object_action(service.restore_object, bucket_name, context, payload)
    return None


@router.post("/buckets/{bucket_name}/versions/cleanup", response_model=CleanupObjectVersionsResponse)
def cleanup_object_versions(
    bucket_name: str,
    payload: CleanupObjectVersionsPayload,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: BrowserService = Depends(get_browser_service),
    _: ManagerActor = Depends(get_current_account_admin),
) -> CleanupObjectVersionsResponse:
    return _run_object_action(service.cleanup_object_versions, bucket_name, context, payload)
