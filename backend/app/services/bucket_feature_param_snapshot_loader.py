# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable

from app.models.bucket_filter import BucketFilterRule
from app.models.bucket_listing import BucketListingSummary
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.bucket_feature_param_matching import (
    FEATURE_PARAM_UNAVAILABLE,
    required_feature_param_sources,
)
from app.services.bucket_notification_state import execution_context_sns_feature_enabled
from app.services.listing_progress import (
    ListingProgressEmitter,
    build_listing_progress_callback,
    invoke_cancel_check,
)
from app.services.s3_execution_context import S3ExecutionTarget

BUCKET_FEATURE_PARAM_MAX_WORKERS = 6
_FEATURE_PARAM_SOURCE_ORDER = (
    "props",
    "lifecycle",
    "logging",
    "website",
    "policy",
    "notifications",
    "encryption",
)


def bucket_identity_key(bucket: BucketListingSummary) -> str:
    return f"{bucket.tenant or ''}:{bucket.name}"


def _load_feature_param_source(loader: Callable[[], object]) -> object:
    try:
        return loader()
    except RuntimeError:
        return FEATURE_PARAM_UNAVAILABLE


def _load_feature_param_snapshot_for_bucket(
    bucket: BucketListingSummary,
    required_sources: set[str],
    service: BucketConfigurationService,
    execution_context: S3ExecutionTarget,
    *,
    request_bucket_name: str | None = None,
) -> dict[str, object]:
    effective_bucket_name = request_bucket_name or bucket.name
    snapshot: dict[str, object] = {}
    source_loaders: dict[str, Callable[[], object]] = {
        "props": lambda: service.get_bucket_properties(effective_bucket_name, execution_context),
        "lifecycle": lambda: service.get_lifecycle(effective_bucket_name, execution_context).rules or [],
        "logging": lambda: service.get_bucket_logging(effective_bucket_name, execution_context),
        "website": lambda: service.get_bucket_website(effective_bucket_name, execution_context),
        "policy": lambda: service.get_policy(effective_bucket_name, execution_context),
        "notifications": lambda: service.get_bucket_notifications(effective_bucket_name, execution_context).configuration or {},
        "encryption": lambda: service.get_bucket_encryption(effective_bucket_name, execution_context),
    }
    for source in _FEATURE_PARAM_SOURCE_ORDER:
        if source not in required_sources:
            continue
        if source == "notifications" and not execution_context_sns_feature_enabled(execution_context):
            snapshot[source] = FEATURE_PARAM_UNAVAILABLE
            continue
        snapshot[source] = _load_feature_param_source(source_loaders[source])
    return snapshot


def load_bucket_feature_param_snapshots(
    buckets: list[BucketListingSummary],
    rules: list[BucketFilterRule],
    service: BucketConfigurationService,
    execution_context: S3ExecutionTarget,
    *,
    progress: ListingProgressEmitter | None = None,
    progress_stage: str = "feature_param_enrichment",
    progress_message: str = "Loading bucket feature parameters",
    progress_start: int = 82,
    progress_end: int = 88,
    cancel_check: Callable[[], None] | None = None,
    bucket_name_resolver: Callable[[BucketListingSummary], str] | None = None,
) -> tuple[dict[str, dict[str, object]], set[str]]:
    snapshots: dict[str, dict[str, object]] = {}
    if not buckets:
        return snapshots, set()
    required_sources = required_feature_param_sources(rules)
    if not required_sources:
        available = {bucket_identity_key(bucket) for bucket in buckets}
        return snapshots, available

    def load_one(bucket: BucketListingSummary) -> tuple[str, dict[str, object]]:
        request_bucket_name = (
            bucket_name_resolver(bucket) if bucket_name_resolver is not None else bucket.name
        )
        snapshot = _load_feature_param_snapshot_for_bucket(
            bucket,
            required_sources,
            service,
            execution_context,
            request_bucket_name=request_bucket_name,
        )
        return bucket_identity_key(bucket), snapshot

    max_workers = min(BUCKET_FEATURE_PARAM_MAX_WORKERS, len(buckets))
    total = len(buckets)
    emit_progress = build_listing_progress_callback(
        progress,
        stage=progress_stage,
        message=progress_message,
        start=progress_start,
        end=progress_end,
        total=total,
    )

    if max_workers <= 1:
        for index, bucket in enumerate(buckets, start=1):
            invoke_cancel_check(cancel_check)
            key, snapshot = load_one(bucket)
            snapshots[key] = snapshot
            emit_progress(index)
            invoke_cancel_check(cancel_check)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(load_one, bucket) for bucket in buckets]
            for index, future in enumerate(as_completed(futures), start=1):
                invoke_cancel_check(cancel_check)
                key, snapshot = future.result()
                snapshots[key] = snapshot
                emit_progress(index)
                invoke_cancel_check(cancel_check)

    available_keys: set[str] = set()
    for key, snapshot in snapshots.items():
        if all(
            snapshot.get(source, FEATURE_PARAM_UNAVAILABLE) is not FEATURE_PARAM_UNAVAILABLE
            for source in required_sources
        ):
            available_keys.add(key)
    return snapshots, available_keys
