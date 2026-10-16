# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Optional

from fastapi import APIRouter, Depends, status

from app.models.access_context import ManagerActor
from app.models.manager_object_listing import ListObjectsResponse
from app.routers.dependencies import get_s3_execution_context, get_current_account_admin
from app.services.manager_object_listing_service import (
    ManagerObjectListingService,
    get_manager_object_listing_service,
)
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.http_errors import raise_http_exception_from_exception

router = APIRouter(prefix="/manager/buckets/{bucket_name}/objects", tags=["manager-objects"])


@router.get("", response_model=ListObjectsResponse)
def list_objects(
    bucket_name: str,
    prefix: str = "",
    continuation_token: Optional[str] = None,
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: ManagerObjectListingService = Depends(get_manager_object_listing_service),
    _: ManagerActor = Depends(get_current_account_admin),
):
    try:
        return service.list_objects(bucket_name, context, prefix=prefix, continuation_token=continuation_token)
    except RuntimeError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
