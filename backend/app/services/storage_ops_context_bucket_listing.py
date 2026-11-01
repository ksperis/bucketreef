# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import Callable

from app.models.bucket_filter import BucketFilterQuery
from app.models.storage_ops import StorageOpsBucketSummary
from app.services.bucket_listing_cache import get_cached_bucket_listing_for_context
from app.services.bucket_listing_enrichment import enrich_buckets
from app.services.bucket_owner_enrichment import BucketOwnerMetadataService
from app.services.buckets_service import BucketsService
from app.services.listing_progress import ListingProgressEmitter, interpolate_progress_percent
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_filtering import (
    apply_storage_ops_advanced_filter,
    build_storage_ops_cheap_field_prefilter,
    encode_storage_ops_bucket_ref,
    match_storage_ops_simple_search,
)
from app.services.storage_ops_bucket_listing_request import StorageOpsBucketListingRequest
from app.services.storage_ops_context_resolution import (
    StorageOpsResolvedContext,
    build_storage_ops_bucket_identity,
    resolve_storage_ops_context_owner,
)
from app.utils.cancellation import invoke_cancel_check


logger = logging.getLogger(__name__)


def enrich_storage_ops_page_owner_metadata(
    *,
    page_items: list[StorageOpsBucketSummary],
    resolved_contexts_by_id: dict[str, StorageOpsResolvedContext],
    include_name: bool,
    include_suspended: bool,
    include_quota: bool,
    progress: ListingProgressEmitter | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> list[StorageOpsBucketSummary]:
    if not page_items or (not include_name and not include_suspended and not include_quota):
        return page_items

    buckets_by_context: dict[str, list[StorageOpsBucketSummary]] = {}
    for bucket in page_items:
        buckets_by_context.setdefault(bucket.context_id, []).append(bucket)

    processed = 0
    total = len(page_items)
    for context_id, buckets in buckets_by_context.items():
        invoke_cancel_check(cancel_check)
        resolved = resolved_contexts_by_id.get(context_id)
        if resolved is not None:
            metadata = BucketOwnerMetadataService(
                endpoint_id=int(resolved.context.storage_endpoint_id or 0),
                execution_context=resolved.context,
            )
            metadata.enrich_buckets(
                buckets,
                include_name=include_name,
                include_suspended=include_suspended,
                include_quota=include_quota,
            )
        processed += len(buckets)
        if progress is not None:
            progress.emit(
                percent=interpolate_progress_percent(92, 98, processed=processed, total=total),
                stage="page_enrichment",
                processed=processed,
                total=total,
                message="Loading page owner metadata",
            )
        invoke_cancel_check(cancel_check)
    return page_items


def _load_storage_ops_context_buckets(
    *,
    context: StorageOpsResolvedContext,
    service: BucketsService,
    needs_stats: bool,
) -> list[StorageOpsBucketSummary]:
    ref = context.ref
    execution_context = context.context
    try:
        listed = get_cached_bucket_listing_for_context(
            context=execution_context,
            include=set(),
            with_stats=needs_stats,
            builder=lambda: service.list_buckets(
                execution_context,
                include=None,
                with_stats=needs_stats,
            ),
        )
    except RuntimeError as exc:
        logger.warning("Storage Ops listing failed for context %s: %s", ref.context_id, exc)
        return []

    owner_identity = resolve_storage_ops_context_owner(execution_context)
    return [
        StorageOpsBucketSummary(
            name=bucket.name,
            bucket_name=bucket.name,
            tenant=owner_identity.tenant,
            owner=owner_identity.owner,
            owner_name=None,
            used_bytes=bucket.used_bytes,
            object_count=bucket.object_count,
            quota_max_size_bytes=bucket.quota_max_size_bytes,
            quota_max_objects=bucket.quota_max_objects,
            context_id=ref.context_id,
            context_name=ref.context_name,
            context_kind=ref.context_kind,
            endpoint_id=ref.endpoint_id,
            endpoint_name=ref.endpoint_name,
            bucket_identity=build_storage_ops_bucket_identity(
                ref.endpoint_id,
                owner_identity.tenant,
                bucket.name,
            ),
        )
        for bucket in listed
    ]


def _enrich_storage_ops_context_owner_details(
    *,
    buckets: list[StorageOpsBucketSummary],
    execution_context: S3ExecutionContext,
    query: StorageOpsBucketListingRequest,
) -> list[StorageOpsBucketSummary]:
    if not buckets or not (
        query.filter_requires_owner_name
        or query.filter_requires_owner_suspended
        or query.filter_requires_owner_quota
        or query.owner_usage_required
    ):
        return buckets

    BucketOwnerMetadataService(
        endpoint_id=int(execution_context.storage_endpoint_id or 0),
        execution_context=execution_context,
    ).enrich_buckets(
        buckets,
        include_name=query.filter_requires_owner_name,
        include_suspended=query.filter_requires_owner_suspended,
        include_quota=query.filter_requires_owner_quota,
        include_usage=query.owner_usage_required,
    )
    return buckets


def _prefilter_storage_ops_context_buckets(
    *,
    buckets: list[StorageOpsBucketSummary],
    execution_context: S3ExecutionContext,
    service: BucketsService,
    parsed_filter: BucketFilterQuery | None,
) -> tuple[list[StorageOpsBucketSummary], BucketFilterQuery | None]:
    cheap_prefilter, cheap_prefilter_complete = build_storage_ops_cheap_field_prefilter(
        parsed_filter
    )
    if not cheap_prefilter or not buckets:
        return buckets, parsed_filter

    filtered = apply_storage_ops_advanced_filter(
        buckets,
        cheap_prefilter,
        service=service.configuration,
        context=execution_context,
    )
    return filtered, None if cheap_prefilter_complete else parsed_filter


def _enrich_storage_ops_context_buckets(
    *,
    buckets: list[StorageOpsBucketSummary],
    context: StorageOpsResolvedContext,
    service: BucketsService,
    query: StorageOpsBucketListingRequest,
) -> list[StorageOpsBucketSummary]:
    if not buckets or (not query.requested_features and not query.include_tags):
        return buckets

    ref = context.ref
    enriched_buckets: list[StorageOpsBucketSummary] = []
    for enriched in enrich_buckets(
        buckets,
        query.requested_features,
        query.include_tags,
        service.configuration,
        context.context,
    ):
        enriched_payload = enriched.model_dump(mode="json")
        enriched_payload.update(
            context_id=ref.context_id,
            context_name=ref.context_name,
            context_kind=ref.context_kind,
            endpoint_id=ref.endpoint_id,
            endpoint_name=ref.endpoint_name,
            bucket_name=enriched.name,
            bucket_identity=build_storage_ops_bucket_identity(
                ref.endpoint_id,
                enriched.tenant,
                enriched.name,
            ),
        )
        enriched_buckets.append(StorageOpsBucketSummary.model_validate(enriched_payload))
    return enriched_buckets


def list_storage_ops_context_buckets(
    *,
    context: StorageOpsResolvedContext,
    service: BucketsService,
    query: StorageOpsBucketListingRequest,
) -> list[StorageOpsBucketSummary]:
    execution_context = context.context
    context_buckets = _load_storage_ops_context_buckets(
        context=context,
        service=service,
        needs_stats=query.needs_stats,
    )
    context_buckets = _enrich_storage_ops_context_owner_details(
        buckets=context_buckets,
        execution_context=execution_context,
        query=query,
    )
    context_buckets, effective_filter = _prefilter_storage_ops_context_buckets(
        buckets=context_buckets,
        execution_context=execution_context,
        service=service,
        parsed_filter=query.parsed_filter,
    )
    if not context_buckets:
        return []
    context_buckets = _enrich_storage_ops_context_buckets(
        buckets=context_buckets,
        context=context,
        service=service,
        query=query,
    )

    context_buckets = apply_storage_ops_advanced_filter(
        context_buckets,
        effective_filter,
        service=service.configuration,
        context=execution_context,
    )
    if query.normalized_search:
        context_buckets = [
            bucket
            for bucket in context_buckets
            if match_storage_ops_simple_search(bucket, query.normalized_search)
        ]

    ref = context.ref
    for bucket in context_buckets:
        bucket.name = encode_storage_ops_bucket_ref(
            ref.context_id,
            bucket.bucket_name or bucket.name,
        )
    return context_buckets
