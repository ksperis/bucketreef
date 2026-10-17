# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.db import User
from app.models.storage_ops import StorageOpsSummary
from app.routers.dependencies import get_current_storage_ops_admin
from app.services.storage_ops_summary_service import StorageOpsSummaryService

router = APIRouter(prefix="/storage-ops", tags=["storage-ops"])


@router.get("/summary", response_model=StorageOpsSummary)
def storage_ops_summary(
    user: User = Depends(get_current_storage_ops_admin),
    db: Session = Depends(get_db),
) -> StorageOpsSummary:
    return StorageOpsSummaryService(db).build(user)
