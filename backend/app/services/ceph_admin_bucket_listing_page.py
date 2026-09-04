# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable

from app.models.bucket_listing import BucketListingSummary
from app.models.ceph_admin import PaginatedCephAdminBucketsResponse
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.bucket_listing_enrichment import enrich_buckets
from app.services.bucket_listing_owner_metadata import (
    apply_owner_enrichment,
    backfill_bucket_owner_metadata,
    resolve_owner_names_for_buckets,
)
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.ceph_admin_bucket_listing_cache import (
    CephAdminBucketListingSnapshot,
    clone_ceph_admin_bucket_list,
)
from app.services.ceph_admin_bucket_listing_context import CephAdminBucketListingContext
from app.services.ceph_admin_bucket_listing_request import CephAdminBucketListingRequest
from app.services.listing_progress import ListingProgressEmitter, invoke_cancel_check
from app.services.s3_execution_context import build_ceph_admin_s3_context
from app.utils.tagging import TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN


class CephAdminBucketPageBuilder:
    """Filter and enrich an actor's response without mutating the shared snapshot."""

    def __init__(
        self,
        *,
        ctx: CephAdminBucketListingContext,
        request: CephAdminBucketListingRequest,
        listing: CephAdminBucketListingSnapshot,
        progress: ListingProgressEmitter,
        cancel_check: Callable[[], None] | None,
        bucket_ui_tags_service: BucketUiTagsService | None,
        actor_user_id: int | None,
    ) -> None:
        self.ctx = ctx
        self.request = request
        self.listing = listing
        self.progress = progress
        self.cancel_check = cancel_check
        self.bucket_ui_tags_service = bucket_ui_tags_service
        self.actor_user_id = actor_user_id

    def build(self, *, page: int, page_size: int) -> PaginatedCephAdminBucketsResponse:
        self.progress.emit(
            percent=92,
            stage="sort_paginate",
            message="Sorting and paginating results",
            force=True,
        )
        filtered_results = self._apply_simple_filter(self.listing.items)
        filtered_results = self._apply_ui_tags(filtered_results)
        invoke_cancel_check(self.cancel_check)
        total = len(filtered_results)
        start = max(page - 1, 0) * page_size
        end = start + page_size
        page_items = clone_ceph_admin_bucket_list(filtered_results[start:end])
        page_items = self._backfill_owner_metadata(page_items)
        page_items = self._enrich_bucket_details(page_items)
        self._enrich_owner_names(page_items)
        page_items = self._enrich_owner_attributes(page_items)
        invoke_cancel_check(self.cancel_check)
        response = PaginatedCephAdminBucketsResponse(
            items=page_items,
            total=total,
            page=page,
            page_size=page_size,
            has_next=end < total,
            stats_available=self.listing.stats_available,
            stats_warning=self.listing.stats_warning,
        )
        self.progress.emit(
            percent=100,
            stage="finalize",
            processed=total,
            total=total,
            message="Search completed",
            force=True,
        )
        return response

    def _apply_ui_tags(
        self,
        results: list[BucketListingSummary],
    ) -> list[BucketListingSummary]:
        if self.bucket_ui_tags_service is None or self.actor_user_id is None:
            return results
        results = clone_ceph_admin_bucket_list(results)
        targets = [
            PhysicalBucketTarget.create(self.ctx.endpoint.id, bucket.tenant, bucket.name)
            for bucket in results
        ]
        tags_by_target = self.bucket_ui_tags_service.get_tags_for_targets(
            domain_kind=TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
            actor_user_id=self.actor_user_id,
            targets=targets,
        )
        requested = set(self.request.ui_tag_ids)
        matched: list[BucketListingSummary] = []
        for bucket, target in zip(results, targets):
            bucket.ui_tags = list(tags_by_target.get(target, []))
            if not requested:
                matched.append(bucket)
                continue
            assigned = {tag.id for tag in bucket.ui_tags}
            include = requested.issubset(assigned) if self.request.ui_tag_match == "all" else bool(requested & assigned)
            if include:
                matched.append(bucket)
        return matched

    def _apply_simple_filter(
        self,
        results: list[BucketListingSummary],
    ) -> list[BucketListingSummary]:
        if not self.request.simple_filter:
            return results
        filter_value = self.request.simple_filter.lower()
        if self.request.advanced_filter:
            return [bucket for bucket in results if filter_value in bucket.name.lower()]
        return [
            bucket
            for bucket in results
            if filter_value in bucket.name.lower()
            or filter_value in (bucket.tenant or "").lower()
            or filter_value in (bucket.owner or "").lower()
        ]

    def _backfill_owner_metadata(
        self,
        page_items: list[BucketListingSummary],
    ) -> list[BucketListingSummary]:
        if not page_items:
            return page_items
        self.progress.emit(
            percent=94,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page bucket metadata",
            force=True,
        )
        return backfill_bucket_owner_metadata(
            self.ctx,
            page_items,
            include_tenant=(
                self.request.wants_owner_name
                or self.request.wants_owner_suspended
                or self.request.wants_owner_quota
                or self.request.wants_owner_quota_usage
            ),
            progress=self.progress,
            cancel_check=self.cancel_check,
            progress_stage="page_enrichment",
            progress_message="Loading page bucket metadata",
            progress_start=94,
            progress_end=96,
        )

    def _enrich_bucket_details(
        self,
        page_items: list[BucketListingSummary],
    ) -> list[BucketListingSummary]:
        requested = set(self.request.requested_features) | set(self.request.requested_detail_fields)
        if not requested and not self.request.include_tags:
            return page_items
        self.progress.emit(
            percent=96,
            stage="page_enrichment",
            processed=0,
            total=len(page_items),
            message="Loading page bucket details",
            force=True,
        )
        return enrich_buckets(
            page_items,
            requested,
            include_tags=self.request.include_tags,
            service=BucketConfigurationService(),
            account=build_ceph_admin_s3_context(self.ctx),
            progress=self.progress,
            cancel_check=self.cancel_check,
            progress_stage="page_enrichment",
            progress_message="Loading page bucket details",
            progress_start=96,
            progress_end=99,
        )

    def _enrich_owner_names(self, page_items: list[BucketListingSummary]) -> None:
        if not self.request.wants_owner_name or not page_items:
            return
        owner_name_by_key = resolve_owner_names_for_buckets(self.ctx, page_items, owner_scope="any")
        for bucket in page_items:
            if not bucket.owner:
                bucket.owner_name = None
                continue
            owner_key = f"{bucket.tenant or ''}:{bucket.owner}"
            bucket.owner_name = owner_name_by_key.get(owner_key, bucket.owner_name)

    def _enrich_owner_attributes(
        self,
        page_items: list[BucketListingSummary],
    ) -> list[BucketListingSummary]:
        if not page_items or not (
            self.request.wants_owner_suspended
            or self.request.wants_owner_quota
            or self.request.wants_owner_quota_usage
        ):
            return page_items
        return apply_owner_enrichment(
            self.ctx,
            page_items,
            include_suspended=self.request.wants_owner_suspended,
            include_quota=self.request.wants_owner_quota or self.request.wants_owner_quota_usage,
            include_usage=self.request.wants_owner_quota_usage,
            usage_by_key=self.listing.owner_usage_by_key,
        )
