# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app.models.manager_activity import ManagerActivityEntry, ManagerActivityListingRequest
from app.routers.dependencies import get_manager_activity_service, get_s3_execution_context
from app.services.manager_activity_service import (
    ManagerActivityDisabledError,
    ManagerActivityService,
    ManagerActivityUnavailableError,
)
from app.services.s3_execution_context import S3ExecutionContext

router = APIRouter(prefix="/manager/activity", tags=["manager-activity"])


@router.get("", response_model=list[ManagerActivityEntry])
def list_manager_activity(
    query: Annotated[ManagerActivityListingRequest, Depends()],
    context: S3ExecutionContext = Depends(get_s3_execution_context),
    service: ManagerActivityService = Depends(get_manager_activity_service),
) -> list[ManagerActivityEntry]:
    try:
        return service.list_activity(context, query)
    except ManagerActivityUnavailableError:
        raise HTTPException(status_code=404, detail="Activity history is unavailable for this Manager context")
    except ManagerActivityDisabledError:
        raise HTTPException(status_code=403, detail="Activity history is disabled for this Manager context")
