# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from app.models.bucket_filter import BucketFilterQuery
from app.services.bucket_listing_enrichment import BUCKET_LISTING_INCLUDES
from app.services.bucket_listing_owner_metadata import (
    BucketOwnerMetadataRequirements,
    filter_owner_metadata_requirements,
    requested_owner_metadata_requirements,
)
from app.services.bucket_listing_shared import filter_requires_stats, parse_filter, parse_includes
from app.utils.normalize import normalize_text


@dataclass(frozen=True)
class StorageOpsBucketListingRequest:
    parsed_filter: BucketFilterQuery | None
    normalized_search: str
    requested_features: set[str]
    include_tags: bool
    needs_stats: bool
    filter_owner_metadata: BucketOwnerMetadataRequirements
    requested_owner_metadata: BucketOwnerMetadataRequirements
    owner_usage_required: bool


def prepare_storage_ops_bucket_listing_request(
    *,
    filter: str | None,
    advanced_filter: str | None,
    include: list[str],
    with_stats: bool,
    sort_by: str,
) -> StorageOpsBucketListingRequest:
    simple_filter: str | None = None
    parsed_filter: BucketFilterQuery | None = None
    if advanced_filter:
        simple_filter, parsed_filter = parse_filter(advanced_filter)
    elif filter:
        simple_filter, parsed_filter = parse_filter(filter)

    include_set = parse_includes(include)
    filter_owner_metadata = filter_owner_metadata_requirements(parsed_filter)
    requested_owner_metadata = requested_owner_metadata_requirements(include_set)
    rules = parsed_filter.rules if parsed_filter and parsed_filter.rules else []
    required_feature_include = {
        rule.feature
        for rule in rules
        if rule.feature and rule.state is not None
    }
    include_tags = "tags" in include_set or any(
        rule.field == "tag" for rule in rules
    )
    requested_features = (include_set | required_feature_include) & BUCKET_LISTING_INCLUDES
    needs_stats = bool(
        with_stats
        or filter_requires_stats(parsed_filter)
        or sort_by in {"used_bytes", "object_count"}
    )
    owner_usage_required = bool(
        needs_stats
        and (filter_owner_metadata.usage or requested_owner_metadata.usage)
    )
    return StorageOpsBucketListingRequest(
        parsed_filter=parsed_filter,
        normalized_search=normalize_text(simple_filter or ""),
        requested_features=requested_features,
        include_tags=include_tags,
        needs_stats=needs_stats,
        filter_owner_metadata=filter_owner_metadata,
        requested_owner_metadata=requested_owner_metadata,
        owner_usage_required=owner_usage_required,
    )
