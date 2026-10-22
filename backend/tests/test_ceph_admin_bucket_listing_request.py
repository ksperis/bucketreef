# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import json

from app.services.ceph_admin_bucket_listing_request import CephAdminBucketListingRequest


def _parse(**overrides) -> CephAdminBucketListingRequest:
    values = {
        "raw_filter": None,
        "raw_advanced_filter": None,
        "sort_by": "name",
        "sort_dir": "asc",
        "include": [],
        "with_stats": False,
    }
    values.update(overrides)
    return CephAdminBucketListingRequest.parse(**values)


def test_bucket_listing_request_normalizes_simple_and_advanced_filters():
    simple = _parse(raw_filter="  research  ")
    advanced = _parse(
        raw_filter="  retained-simple  ",
        raw_advanced_filter=json.dumps(
            {"match": "all", "rules": [{"field": "name", "op": "eq", "value": "alpha"}]}
        ),
    )

    assert simple.simple_filter == "research"
    assert simple.advanced_filter is None
    assert advanced.simple_filter == "retained-simple"
    assert advanced.advanced_filter is not None
    assert advanced.advanced_filter.rules[0].field == "name"


def test_bucket_listing_request_derives_stats_and_include_requirements():
    request = _parse(
        raw_advanced_filter=json.dumps(
            {"match": "all", "rules": [{"field": "used_bytes", "op": "gte", "value": 10}]}
        ),
        include=[
            "owner_name",
            "owner_suspended",
            "owner_quota",
            "owner_quota_usage",
            "tags",
            "versioning",
            "object_lock_mode",
        ],
    )

    assert request.stats_required is True
    assert request.with_stats is True
    assert request.wants_owner_name is True
    assert request.wants_owner_suspended is True
    assert request.wants_owner_quota is True
    assert request.wants_owner_quota_usage is True
    assert request.owner_usage_required is True
    assert request.include_tags is True
    assert request.requested_features == frozenset({"versioning"})
    assert request.requested_detail_fields == frozenset({"object_lock_mode"})


def test_bucket_listing_request_normalizes_ui_tag_options():
    request = _parse(
        ui_tag_ids=[3, 0, 3, -1, 5],
        ui_tag_match="invalid",
        with_ui_tags=True,
    )

    assert request.ui_tag_ids == (3, 5)
    assert request.ui_tag_match == "any"
    assert request.needs_owner_metadata is True
    assert request.needs_tenant_metadata is True


def test_bucket_listing_request_preserves_explicit_all_ui_tag_match():
    request = _parse(ui_tag_match="all")
    assert request.ui_tag_match == "all"
