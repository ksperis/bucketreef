# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.db import StorageEndpoint
from app.models.ceph_admin import CephAdminClusterStorageMetrics
from app.models.traffic import TrafficStats
from app.routers.ceph_admin.dependencies import get_ceph_admin_workspace_endpoint
from app.services.rgw_admin import RGWAdminError
from app.services.traffic_service import (
    WINDOW_RESOLUTION_LABELS,
    TrafficWindow,
    aggregate_usage,
    flatten_usage_entries,
    window_start,
)
from app.services.rgw_supervision import get_supervision_rgw_client
from app.utils.http_errors import raise_http_exception_from_exception
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import aggregate_bucket_usage, summarize_bucket_usage

router = APIRouter(prefix="/ceph-admin/endpoints/{endpoint_id}/metrics", tags=["ceph-admin-metrics"])


def _build_supervision_client(endpoint: StorageEndpoint):
    try:
        return get_supervision_rgw_client(endpoint)
    except ValueError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)


def _require_storage_metrics_enabled(endpoint: StorageEndpoint) -> None:
    flags = resolve_feature_flags(endpoint)
    if not flags.metrics_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Storage metrics are disabled for this endpoint",
        )


def _require_usage_logs_enabled(endpoint: StorageEndpoint) -> None:
    flags = resolve_feature_flags(endpoint)
    if not flags.usage_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Usage logs are disabled for this endpoint",
        )


def _normalize_owner(entry: dict[str, Any]) -> str:
    owner = entry.get("owner")
    if isinstance(owner, str) and owner.strip():
        return owner.strip()
    tenant = entry.get("tenant")
    if isinstance(tenant, str) and tenant.strip():
        return tenant.strip()
    return "unknown"


def _normalized_named_buckets(payload: Any) -> list[dict[str, Any]]:
    buckets: list[dict[str, Any]] = []
    for entry in extract_bucket_list(payload):
        if not isinstance(entry, dict):
            continue
        name = entry.get("bucket") or entry.get("name")
        if not isinstance(name, str) or not name.strip():
            continue
        normalized = dict(entry)
        normalized["bucket"] = name.strip()
        buckets.append(normalized)
    return buckets


def _summarize_owner_usage(buckets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets_by_owner: dict[str, list[dict[str, Any]]] = {}
    for bucket in buckets:
        buckets_by_owner.setdefault(_normalize_owner(bucket), []).append(bucket)

    owner_usage = []
    for owner, owner_buckets in buckets_by_owner.items():
        used_bytes, object_count, bucket_count = aggregate_bucket_usage(owner_buckets)
        owner_usage.append(
            {
                "owner": owner,
                "used_bytes": used_bytes,
                "object_count": object_count,
                "bucket_count": bucket_count,
            }
        )
    owner_usage.sort(key=lambda item: item.get("used_bytes") or 0, reverse=True)
    return owner_usage


@router.get("/storage", response_model=CephAdminClusterStorageMetrics)
def cluster_storage_metrics(
    endpoint: StorageEndpoint = Depends(get_ceph_admin_workspace_endpoint),
) -> CephAdminClusterStorageMetrics:
    _require_storage_metrics_enabled(endpoint)
    rgw_admin = _build_supervision_client(endpoint)
    try:
        payload = rgw_admin.get_all_buckets(with_stats=True)
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    buckets = _normalized_named_buckets(payload)
    bucket_usage, total_bytes, total_objects, total_buckets = summarize_bucket_usage(buckets)
    owner_usage = _summarize_owner_usage(buckets)

    return CephAdminClusterStorageMetrics(
        total_buckets=total_buckets,
        bucket_usage=bucket_usage,
        owner_usage=owner_usage,
        storage_totals={
            "used_bytes": total_bytes,
            "object_count": total_objects,
            "bucket_count": total_buckets,
            "owners_with_usage": len(owner_usage),
        },
        generated_at=datetime.now(timezone.utc).replace(microsecond=0),
    )


@router.get("/traffic", response_model=TrafficStats)
def cluster_traffic_metrics(
    window: TrafficWindow = Query(TrafficWindow.WEEK),
    bucket: Optional[str] = Query(None),
    endpoint: StorageEndpoint = Depends(get_ceph_admin_workspace_endpoint),
) -> TrafficStats:
    _require_usage_logs_enabled(endpoint)
    rgw_admin = _build_supervision_client(endpoint)
    reference = datetime.now(timezone.utc).replace(microsecond=0)
    start = window_start(reference, window)
    try:
        payload = rgw_admin.get_usage(
            uid=None,
            tenant=None,
            start=start,
            end=reference,
            show_entries=True,
            show_summary=False,
        )
    except RGWAdminError as exc:
        raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

    entries = flatten_usage_entries(payload)
    bucket_filter = bucket.strip() if isinstance(bucket, str) else None
    if bucket_filter == "":
        bucket_filter = None
    aggregation = aggregate_usage(entries, start=start, end=reference, window=window, bucket_filter=bucket_filter)
    aggregation.update(
        {
            "window": window.value if isinstance(window, TrafficWindow) else str(window),
            "start": start.isoformat(),
            "end": reference.isoformat(),
            "resolution": WINDOW_RESOLUTION_LABELS.get(window, "per-entry"),
            "bucket_filter": bucket_filter,
        }
    )
    aggregation["data_points"] = len(aggregation.get("series") or [])
    return TrafficStats.model_validate(aggregation)
