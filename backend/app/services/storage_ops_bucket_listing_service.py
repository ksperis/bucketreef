# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from typing import Callable

from app.models.storage_ops import PaginatedStorageOpsBucketsResponse, StorageOpsBucketSummary
from app.services.bucket_ui_tags_service import (
    BucketUiTagsService,
    PhysicalBucketTarget,
    matches_bucket_ui_tag_filter,
)
from app.services.buckets_service import BucketsService
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    interpolate_progress_percent,
)
from app.services.s3_execution_context import S3ExecutionContext
from app.services.storage_ops_bucket_filtering import sort_storage_ops_buckets
from app.services.storage_ops_bucket_listing_request import (
    StorageOpsBucketListingRequest,
    prepare_storage_ops_bucket_listing_request,
)
from app.services.storage_ops_context_bucket_listing import (
    enrich_storage_ops_page_owner_metadata,
    list_storage_ops_context_buckets,
)
from app.services.storage_ops_context_resolution import (
    StorageOpsContextRef,
    StorageOpsResolvedContext,
    filter_storage_ops_context_refs_by_advanced_filter,
    resolve_storage_ops_contexts,
)
from app.utils.cancellation import invoke_cancel_check
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_STORAGE_OPS


logger = logging.getLogger(__name__)


STORAGE_OPS_CONTEXT_LISTING_MAX_WORKERS = 6


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
        self.ui_tag_ids = tuple(
            dict.fromkeys(int(item) for item in (ui_tag_ids or []) if int(item) > 0)
        )
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
        targets = [self._physical_target(bucket) for bucket in results]
        physical_targets = [target for target in targets if target is not None]
        tags_by_target = {}
        if physical_targets:
            tags_by_target = self.bucket_ui_tags_service.get_tags_for_targets(
                domain_kind=TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
                actor_user_id=self.actor_user_id,
                targets=physical_targets,
            )
        requested = set(self.ui_tag_ids)
        matched: list[StorageOpsBucketSummary] = []
        for bucket, target in zip(results, targets):
            bucket.ui_tags = list(tags_by_target.get(target, [])) if target is not None else []
            if matches_bucket_ui_tag_filter(
                bucket.ui_tags,
                requested,
                self.ui_tag_match,
            ):
                matched.append(bucket)
        return matched

    @staticmethod
    def _physical_target(
        bucket: StorageOpsBucketSummary,
    ) -> PhysicalBucketTarget | None:
        endpoint_id = int(bucket.endpoint_id or 0)
        if endpoint_id <= 0:
            return None
        return PhysicalBucketTarget.create(
            endpoint_id,
            bucket.tenant,
            bucket.bucket_name or bucket.name,
        )

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
        refs = filter_storage_ops_context_refs_by_advanced_filter(
            refs,
            query.parsed_filter,
        )
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
        return enrich_storage_ops_page_owner_metadata(
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
