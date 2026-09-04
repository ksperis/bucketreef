# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable

from app.models.ceph_admin import PaginatedCephAdminBucketsResponse
from app.services.bucket_ui_tags_service import BucketUiTagsService
from app.services.ceph_admin_bucket_listing_cache import get_cached_bucket_listing
from app.services.ceph_admin_bucket_listing_context import CephAdminBucketListingContext
from app.services.ceph_admin_bucket_listing_page import CephAdminBucketPageBuilder
from app.services.ceph_admin_bucket_listing_request import CephAdminBucketListingRequest
from app.services.ceph_admin_bucket_listing_snapshot import CephAdminBucketSnapshotBuilder
from app.services.listing_progress import (
    ListingProgressEmitter,
    ListingProgressSnapshot,
    invoke_cancel_check,
)


def compute_ceph_admin_bucket_listing(
    *,
    page: int,
    page_size: int,
    filter: str | None,
    advanced_filter: str | None,
    sort_by: str,
    sort_dir: str,
    include: list[str],
    with_stats: bool,
    ctx: CephAdminBucketListingContext,
    ui_tag_ids: list[int] | None = None,
    ui_tag_match: str = "any",
    bucket_ui_tags_service: BucketUiTagsService | None = None,
    actor_user_id: int | None = None,
    progress_callback: Callable[[ListingProgressSnapshot], None] | None = None,
    cancel_check: Callable[[], None] | None = None,
) -> PaginatedCephAdminBucketsResponse:
    progress = ListingProgressEmitter(progress_callback)
    invoke_cancel_check(cancel_check)
    progress.emit(percent=5, stage="prepare", message="Preparing advanced search", force=True)
    listing_request = CephAdminBucketListingRequest.parse(
        raw_filter=filter,
        raw_advanced_filter=advanced_filter,
        sort_by=sort_by,
        sort_dir=sort_dir,
        include=include,
        with_stats=with_stats,
        ui_tag_ids=ui_tag_ids,
        ui_tag_match=ui_tag_match,
        with_ui_tags=bucket_ui_tags_service is not None,
    )
    invoke_cancel_check(cancel_check)
    snapshot_builder = CephAdminBucketSnapshotBuilder(
        ctx=ctx,
        request=listing_request,
        progress=progress,
        cancel_check=cancel_check,
    )
    invoke_cancel_check(cancel_check)
    endpoint_id = int(getattr(ctx.endpoint, "id", 0) or 0)
    listing = get_cached_bucket_listing(
        listing_request.cache_key(endpoint_id),
        snapshot_builder.build,
    )
    return CephAdminBucketPageBuilder(
        ctx=ctx,
        request=listing_request,
        listing=listing,
        progress=progress,
        cancel_check=cancel_check,
        bucket_ui_tags_service=bucket_ui_tags_service,
        actor_user_id=actor_user_id,
    ).build(page=page, page_size=page_size)
