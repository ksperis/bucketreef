# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import json
import logging
from typing import Callable, Iterable

from app.models.bucket_filter import BucketFilterQuery, BucketFilterRule
from app.models.execution_context import ExecutionContext
from app.models.storage_ops import PaginatedStorageOpsBucketsResponse, StorageOpsBucketSummary, StorageOpsContextKind
from app.services.bucket_listing_cache import get_cached_bucket_listing_for_context
from app.services.bucket_listing_enrichment import enrich_buckets
from app.services.storage_ops_bucket_filtering import (
    apply_storage_ops_advanced_filter,
    build_storage_ops_cheap_field_prefilter,
    encode_storage_ops_bucket_ref,
    match_storage_ops_simple_search,
    match_storage_ops_field_rule,
    sort_storage_ops_buckets,
)
from app.services.storage_ops_bucket_listing_request import (
    StorageOpsBucketListingRequest,
    prepare_storage_ops_bucket_listing_request,
)
from app.services.bucket_owner_enrichment import BucketOwnerMetadataService
from app.services.buckets_service import BucketsService
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.connection_identity_service import ConnectionIdentityService
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    interpolate_progress_percent,
    invoke_cancel_check,
)
from app.services.rgw_principal_scope import resolve_target_tenant
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_STORAGE_OPS

logger = logging.getLogger(__name__)


STORAGE_OPS_CONTEXT_LISTING_MAX_WORKERS = 6
CONTEXT_IDENTITY_FIELDS = {"context_id", "context_name", "context_kind", "endpoint_name"}


@dataclass(frozen=True)
class StorageOpsContextRef:
    context_id: str
    context_name: str
    context_kind: StorageOpsContextKind
    endpoint_id: int | None
    endpoint_name: str | None


@dataclass(frozen=True)
class StorageOpsResolvedContext:
    ref: StorageOpsContextRef
    context: S3ExecutionContext


@dataclass(frozen=True)
class _StorageOpsContextOwner:
    owner: str | None
    tenant: str | None = None


def build_storage_ops_bucket_identity(endpoint_id: int | None, tenant: str | None, bucket_name: str) -> str | None:
    if endpoint_id is None or endpoint_id <= 0:
        return None
    name = str(bucket_name or "").strip()
    if not name:
        return None
    return json.dumps([endpoint_id, str(tenant or "").strip(), name], ensure_ascii=False, separators=(",", ":"))


def build_storage_ops_context_refs(contexts: Iterable[ExecutionContext]) -> list[StorageOpsContextRef]:
    refs: list[StorageOpsContextRef] = []
    seen: set[str] = set()
    for context in contexts:
        if context.kind not in {"account", "connection", "s3_user"}:
            continue
        if context.id in seen:
            continue
        seen.add(context.id)
        context_kind: StorageOpsContextKind
        if context.kind == "s3_user":
            context_kind = "s3_user"
        else:
            context_kind = context.kind
        refs.append(
            StorageOpsContextRef(
                context_id=context.id,
                context_name=context.display_name,
                context_kind=context_kind,
                endpoint_id=context.endpoint_id,
                endpoint_name=context.endpoint_name,
            )
        )
    return refs


def _context_probe_bucket(ref: StorageOpsContextRef) -> StorageOpsBucketSummary:
    return StorageOpsBucketSummary(
        name="",
        bucket_name="",
        tenant=None,
        owner=None,
        owner_name=None,
        context_id=ref.context_id,
        context_name=ref.context_name,
        context_kind=ref.context_kind,
        endpoint_id=ref.endpoint_id,
        endpoint_name=ref.endpoint_name,
        bucket_identity=None,
    )


def _context_prefilter_rules(
    parsed_filter: BucketFilterQuery | None,
) -> tuple[list[BucketFilterRule], str] | None:
    if not parsed_filter or not parsed_filter.rules:
        return None
    context_rules = [
        rule
        for rule in parsed_filter.rules
        if rule.field in CONTEXT_IDENTITY_FIELDS
    ]
    if not context_rules:
        return None
    if parsed_filter.match == "any" and any(
        (rule.field and rule.field not in CONTEXT_IDENTITY_FIELDS) or rule.feature
        for rule in parsed_filter.rules
    ):
        return None
    return context_rules, parsed_filter.match


def _context_ref_matches_rules(
    ref: StorageOpsContextRef,
    rules: list[BucketFilterRule],
    *,
    match_mode: str,
) -> bool:
    probe = _context_probe_bucket(ref)
    matches = (
        match_storage_ops_field_rule(probe, rule)
        for rule in rules
    )
    return all(matches) if match_mode == "all" else any(matches)


def _filter_context_refs_by_advanced_filter(
    refs: list[StorageOpsContextRef],
    parsed_filter: BucketFilterQuery | None,
) -> list[StorageOpsContextRef]:
    if not refs:
        return refs
    prefilter = _context_prefilter_rules(parsed_filter)
    if prefilter is None:
        return refs
    context_rules, match_mode = prefilter
    return [
        ref
        for ref in refs
        if _context_ref_matches_rules(
            ref,
            context_rules,
            match_mode=match_mode,
        )
    ]


def resolve_storage_ops_contexts(
    *,
    refs: list[StorageOpsContextRef],
    resolve_context: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
    progress: ListingProgressEmitter | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> list[StorageOpsResolvedContext]:
    resolved: list[StorageOpsResolvedContext] = []
    total = len(refs)
    for index, ref in enumerate(refs, start=1):
        invoke_cancel_check(cancel_check)
        context = resolve_context(ref)
        if context is not None:
            resolved.append(StorageOpsResolvedContext(ref=ref, context=context))
        if progress is not None:
            progress.emit(
                percent=interpolate_progress_percent(15, 25, processed=index, total=total),
                stage="resolve_contexts",
                processed=index,
                total=total,
                message="Resolving Storage Ops contexts",
            )
        invoke_cancel_check(cancel_check)
    return resolved


def _resolve_context_owner(context: S3ExecutionContext) -> _StorageOpsContextOwner:
    account_id = str(context.rgw_account_id or "").strip()
    if account_id:
        return _StorageOpsContextOwner(owner=account_id, tenant=resolve_target_tenant(context))
    user_uid = str(context.rgw_user_uid or "").strip()
    if user_uid:
        return _StorageOpsContextOwner(owner=user_uid, tenant=resolve_target_tenant(context))
    source_connection = context.source_connection
    if source_connection is None:
        return _StorageOpsContextOwner(owner=None)
    resolution = ConnectionIdentityService().resolve_rgw_identity(source_connection)
    if resolution.rgw_user_uid:
        return _StorageOpsContextOwner(owner=resolution.rgw_user_uid, tenant=resolution.rgw_tenant)
    return _StorageOpsContextOwner(owner=resolution.rgw_account_id)


def resolve_storage_ops_context_tenant(context: S3ExecutionContext) -> str:
    """Return the normalized tenant used in the physical bucket identity."""
    return str(_resolve_context_owner(context).tenant or "").strip()


def _apply_page_owner_enrichment(
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
            builder=lambda: service.list_buckets(execution_context, include=None, with_stats=needs_stats),
        )
    except RuntimeError as exc:
        logger.warning("Storage Ops listing failed for context %s: %s", ref.context_id, exc)
        return []

    owner_identity = _resolve_context_owner(execution_context)
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
            bucket_identity=build_storage_ops_bucket_identity(ref.endpoint_id, owner_identity.tenant, bucket.name),
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
            bucket_identity=build_storage_ops_bucket_identity(ref.endpoint_id, enriched.tenant, enriched.name),
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


class _StorageOpsBucketListingPipeline:
    def __init__(
        self,
        *,
        load_context_refs: Callable[[], list[StorageOpsContextRef]],
        resolve_context: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
        service: BucketsService,
        page: int,
        page_size: int,
        filter: str | None,
        advanced_filter: str | None,
        sort_by: str,
        sort_dir: str,
        include: list[str],
        with_stats: bool,
        ui_tag_ids: list[int] | None,
        ui_tag_match: str,
        bucket_ui_tags_service: BucketUiTagsService | None,
        actor_user_id: int | None,
        progress_callback: Callable[[ListingProgressSnapshot], None] | None,
        cancel_check: Callable[[], None] | None,
    ) -> None:
        self.load_context_refs = load_context_refs
        self.resolve_context = resolve_context
        self.service = service
        self.page = page
        self.page_size = page_size
        self.filter = filter
        self.advanced_filter = advanced_filter
        self.sort_by = sort_by
        self.sort_dir = sort_dir
        self.include = include
        self.with_stats = with_stats
        self.ui_tag_ids = tuple(dict.fromkeys(int(item) for item in (ui_tag_ids or []) if int(item) > 0))
        self.ui_tag_match = "all" if ui_tag_match == "all" else "any"
        self.bucket_ui_tags_service = bucket_ui_tags_service
        self.actor_user_id = actor_user_id
        self.progress = ListingProgressEmitter(progress_callback)
        self.cancel_check = cancel_check

    def run(self) -> PaginatedStorageOpsBucketsResponse:
        self.progress.emit(
            percent=5,
            stage="prepare",
            processed=0,
            total=0,
            message="Preparing Storage Ops search",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        query = prepare_storage_ops_bucket_listing_request(
            filter=self.filter,
            advanced_filter=self.advanced_filter,
            include=self.include,
            with_stats=self.with_stats,
            sort_by=self.sort_by,
        )
        contexts = self._resolve_contexts(query)
        results = self._list_contexts(contexts, query)
        results = self._apply_ui_tags(results)
        page_items, total, has_next = self._paginate(results)
        page_items = self._enrich_page(page_items, contexts, query)
        invoke_cancel_check(self.cancel_check)
        self.progress.emit(
            percent=100,
            stage="finalize",
            processed=total,
            total=total,
            message="Search completed",
            force=True,
        )
        return PaginatedStorageOpsBucketsResponse(
            items=page_items,
            total=total,
            page=self.page,
            page_size=self.page_size,
            has_next=has_next,
            stats_available=True,
            stats_warning=None,
        )

    def _apply_ui_tags(
        self,
        results: list[StorageOpsBucketSummary],
    ) -> list[StorageOpsBucketSummary]:
        if self.bucket_ui_tags_service is None or self.actor_user_id is None:
            return results
        targets: list[PhysicalBucketTarget | None] = []
        for bucket in results:
            endpoint_id = int(bucket.endpoint_id or 0)
            targets.append(
                PhysicalBucketTarget.create(
                    endpoint_id,
                    bucket.tenant,
                    bucket.bucket_name or bucket.name,
                )
                if endpoint_id > 0
                else None
            )
        physical_targets = [target for target in targets if target is not None]
        tags_by_target = (
            self.bucket_ui_tags_service.get_tags_for_targets(
                domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
                actor_user_id=self.actor_user_id,
                targets=physical_targets,
            )
            if physical_targets
            else {}
        )
        requested = set(self.ui_tag_ids)
        matched: list[StorageOpsBucketSummary] = []
        for bucket, target in zip(results, targets):
            bucket.ui_tags = list(tags_by_target.get(target, [])) if target is not None else []
            if not requested:
                matched.append(bucket)
                continue
            assigned = {tag.id for tag in bucket.ui_tags}
            include = requested.issubset(assigned) if self.ui_tag_match == "all" else bool(requested & assigned)
            if include:
                matched.append(bucket)
        return matched

    def _resolve_contexts(
        self,
        query: StorageOpsBucketListingRequest,
    ) -> list[StorageOpsResolvedContext]:
        refs = self.load_context_refs()
        self.progress.emit(
            percent=10,
            stage="collect_contexts",
            processed=len(refs),
            total=len(refs),
            message="Collecting Storage Ops contexts",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        refs = _filter_context_refs_by_advanced_filter(refs, query.parsed_filter)
        self.progress.emit(
            percent=15,
            stage="filter_contexts",
            processed=len(refs),
            total=len(refs),
            message="Filtering Storage Ops contexts",
            force=True,
        )
        contexts = resolve_storage_ops_contexts(
            refs=refs,
            resolve_context=self.resolve_context,
            progress=self.progress,
            cancel_check=self.cancel_check,
        )
        self.progress.emit(
            percent=25,
            stage="resolve_contexts",
            processed=len(contexts),
            total=len(refs),
            message="Storage Ops contexts resolved",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        return contexts

    def _list_contexts(
        self,
        contexts: list[StorageOpsResolvedContext],
        query: StorageOpsBucketListingRequest,
    ) -> list[StorageOpsBucketSummary]:
        total = len(contexts)
        self.progress.emit(
            percent=30 if total else 75,
            stage="context_listing",
            processed=0,
            total=total,
            message="Loading context bucket listings",
            force=True,
        )
        if total <= 1:
            return self._list_contexts_serially(contexts, query)
        return self._list_contexts_concurrently(contexts, query)

    def _list_context_buckets(
        self,
        context: StorageOpsResolvedContext,
        query: StorageOpsBucketListingRequest,
    ) -> list[StorageOpsBucketSummary]:
        return list_storage_ops_context_buckets(
            context=context,
            service=self.service,
            query=query,
        )

    def _list_contexts_serially(
        self,
        contexts: list[StorageOpsResolvedContext],
        query: StorageOpsBucketListingRequest,
    ) -> list[StorageOpsBucketSummary]:
        results: list[StorageOpsBucketSummary] = []
        total = len(contexts)
        for index, context in enumerate(contexts, start=1):
            invoke_cancel_check(self.cancel_check)
            results.extend(self._list_context_buckets(context, query))
            self._emit_context_listing_progress(index, total)
            invoke_cancel_check(self.cancel_check)
        return results

    def _list_contexts_concurrently(
        self,
        contexts: list[StorageOpsResolvedContext],
        query: StorageOpsBucketListingRequest,
    ) -> list[StorageOpsBucketSummary]:
        results: list[StorageOpsBucketSummary] = []
        total = len(contexts)
        max_workers = min(STORAGE_OPS_CONTEXT_LISTING_MAX_WORKERS, total)
        with ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="storage-ops-list",
        ) as executor:
            futures = [
                executor.submit(self._list_context_buckets, context, query)
                for context in contexts
            ]
            for index, future in enumerate(as_completed(futures), start=1):
                invoke_cancel_check(self.cancel_check)
                try:
                    results.extend(future.result())
                except Exception as exc:
                    logger.warning("Storage Ops context worker failed: %s", exc)
                self._emit_context_listing_progress(index, total)
                invoke_cancel_check(self.cancel_check)
        return results

    def _emit_context_listing_progress(self, processed: int, total: int) -> None:
        self.progress.emit(
            percent=interpolate_progress_percent(
                30,
                75,
                processed=processed,
                total=total,
            ),
            stage="context_listing",
            processed=processed,
            total=total,
            message="Loading context bucket listings",
        )

    def _paginate(
        self,
        results: list[StorageOpsBucketSummary],
    ) -> tuple[list[StorageOpsBucketSummary], int, bool]:
        self.progress.emit(
            percent=85,
            stage="sort_paginate",
            processed=len(results),
            total=len(results),
            message="Sorting and paginating bucket results",
            force=True,
        )
        invoke_cancel_check(self.cancel_check)
        sorted_items = sort_storage_ops_buckets(
            results,
            sort_by=self.sort_by,
            sort_dir=self.sort_dir,
        )
        total = len(sorted_items)
        start = max(self.page - 1, 0) * self.page_size
        end = start + self.page_size
        return sorted_items[start:end], total, end < total

    def _enrich_page(
        self,
        page_items: list[StorageOpsBucketSummary],
        contexts: list[StorageOpsResolvedContext],
        query: StorageOpsBucketListingRequest,
    ) -> list[StorageOpsBucketSummary]:
        wants_owner_metadata = bool(
            query.wants_owner_name
            or query.wants_owner_suspended
            or query.wants_owner_quota
            or query.wants_owner_quota_usage
        )
        if not page_items or not wants_owner_metadata:
            return page_items
        self.progress.emit(
            percent=92,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page owner metadata",
            force=True,
        )
        return _apply_page_owner_enrichment(
            page_items=page_items,
            resolved_contexts_by_id={
                context.ref.context_id: context for context in contexts
            },
            include_name=query.wants_owner_name,
            include_suspended=query.wants_owner_suspended,
            include_quota=query.wants_owner_quota or query.wants_owner_quota_usage,
            progress=self.progress,
            cancel_check=self.cancel_check,
        )


def compute_storage_ops_bucket_listing(
    *,
    load_context_refs: Callable[[], list[StorageOpsContextRef]],
    resolve_context: Callable[[StorageOpsContextRef], S3ExecutionContext | None],
    service: BucketsService,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
    ui_tag_ids: list[int] | None = None,
    ui_tag_match: str = "any",
    bucket_ui_tags_service: BucketUiTagsService | None = None,
    actor_user_id: int | None = None,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedStorageOpsBucketsResponse:
    return _StorageOpsBucketListingPipeline(
        load_context_refs=load_context_refs,
        resolve_context=resolve_context,
        service=service,
        page=page,
        page_size=page_size,
        filter=filter,
        advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
        ui_tag_ids=ui_tag_ids,
        ui_tag_match=ui_tag_match,
        bucket_ui_tags_service=bucket_ui_tags_service,
        actor_user_id=actor_user_id,
        progress_callback=progress_callback,
        cancel_check=cancel_check,
    ).run()
