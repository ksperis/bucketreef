# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_db
from app.routers.dependencies import require_internal_cron_token
from app.services.bucket_usage_stats_collection_service import BucketUsageStatsCollectionService
from app.services.operation_lease_service import (
    BUCKET_USAGE_STATS_COLLECT_OPERATION,
    BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
    OperationLeaseService,
)


router = APIRouter(prefix="/internal/bucket-usage-stats", tags=["internal-bucket-usage-stats"])


@router.post("/collect")
def collect_bucket_usage_stats(
    _: None = Depends(require_internal_cron_token),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    with OperationLeaseService(db).hold(
        BUCKET_USAGE_STATS_COLLECT_OPERATION,
        ttl_seconds=BUCKET_USAGE_STATS_LEASE_TTL_SECONDS,
        lease_context={"source": "internal"},
    ) as lease:
        if lease is None:
            return {"status": "skipped", "reason": "already_running", "operation": BUCKET_USAGE_STATS_COLLECT_OPERATION}
        return BucketUsageStatsCollectionService(db, SessionLocal).collect()
