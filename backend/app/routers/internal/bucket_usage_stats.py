# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.models.bucket_usage_stats import BucketUsageStatsCollectionResult
from app.models.operation import OperationSkippedResponse
from app.routers.dependencies import require_internal_cron_token
from app.routers.internal.operation_common import run_internal_leased_operation
from app.services.bucket_usage_stats_collection_service import BucketUsageStatsCollectionService
from app.services.operation_lease_service import (
    BUCKET_USAGE_STATS_COLLECT_OPERATION,
    BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
)


router = APIRouter(prefix="/internal/bucket-usage-stats", tags=["internal-bucket-usage-stats"])


@router.post(
    "/collect",
    response_model=BucketUsageStatsCollectionResult | OperationSkippedResponse,
)
def collect_bucket_usage_stats(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> BucketUsageStatsCollectionResult | OperationSkippedResponse:
    return run_internal_leased_operation(
        db,
        BUCKET_USAGE_STATS_COLLECT_OPERATION,
        ttl_seconds=BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
        work=lambda: BucketUsageStatsCollectionService(db, SessionLocal).collect(),
    )
