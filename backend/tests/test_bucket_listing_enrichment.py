# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.models.bucket import (
    BucketObjectLock,
    BucketProperties,
    BucketPublicAccessBlock,
    BucketWebsiteConfiguration,
    BucketWebsiteRedirectAllRequestsTo,
)
from app.models.bucket_listing import BucketListingSummary
from app.services.bucket_listing_enrichment import _enrich_website_configuration, _project_property_details
from app.services.bucket_property_feature_enrichment import BucketPropertiesContext
from app.services.s3_execution_context import S3ExecutionContext


class _WebsiteService:
    def __init__(self, website: BucketWebsiteConfiguration | None = None, *, unavailable: bool = False):
        self.website = website
        self.unavailable = unavailable

    def get_bucket_website(self, _name, _execution_context):
        if self.unavailable:
            raise RuntimeError("unavailable")
        assert self.website is not None
        return self.website


def _context() -> S3ExecutionContext:
    return S3ExecutionContext(
        context_id="1",
        context_kind="account",
        name="account",
        access_key=None,
        secret_key=None,
    )


@pytest.mark.parametrize(
    ("website", "expected_state", "expected_tone", "expected_details"),
    [
        (
            BucketWebsiteConfiguration(
                index_document="  index.html  ",
                error_document="  error.html  ",
                redirect_all_requests_to=BucketWebsiteRedirectAllRequestsTo(host_name="  www.example.test  "),
                routing_rules=[{"Condition": {"KeyPrefixEquals": "docs/"}}],
            ),
            "Enabled",
            "active",
            {
                "website_index_document": "index.html",
                "website_error_document": "error.html",
                "website_redirect_host": "www.example.test",
                "website_routing_rule_count": 1,
            },
        ),
        (
            BucketWebsiteConfiguration(index_document="  ", error_document="  ", routing_rules=[]),
            "Disabled",
            "inactive",
            {
                "website_index_document": None,
                "website_error_document": None,
                "website_redirect_host": None,
                "website_routing_rule_count": 0,
            },
        ),
    ],
)
def test_enrich_website_configuration_projects_normalized_details(
    website,
    expected_state,
    expected_tone,
    expected_details,
):
    feature_map = {}
    column_details = {}

    _enrich_website_configuration(
        BucketListingSummary(name="bucket-a"),
        _WebsiteService(website),
        _context(),
        wants_feature=True,
        detail_keys=set(expected_details),
        feature_map=feature_map,
        column_details=column_details,
    )

    assert feature_map["static_website"].state == expected_state
    assert feature_map["static_website"].tone == expected_tone
    assert column_details == expected_details


def test_enrich_website_configuration_marks_only_requested_details_unavailable():
    feature_map = {}
    column_details = {"unrelated": "keep"}

    _enrich_website_configuration(
        BucketListingSummary(name="bucket-a"),
        _WebsiteService(unavailable=True),
        _context(),
        wants_feature=True,
        detail_keys={"website_index_document", "website_routing_rule_count"},
        feature_map=feature_map,
        column_details=column_details,
    )

    assert feature_map["static_website"].state == "Unavailable"
    assert feature_map["static_website"].tone == "unknown"
    assert column_details == {
        "unrelated": "keep",
        "website_index_document": None,
        "website_routing_rule_count": None,
    }


def _properties_context(*, properties: BucketProperties | None, unavailable: bool = False) -> BucketPropertiesContext:
    return BucketPropertiesContext(
        bucket_name="bucket-a",
        reader=object(),
        execution_context=_context(),
        uses_bundle=True,
        properties=properties,
        unavailable=unavailable,
    )


def test_project_property_details_projects_requested_values():
    properties = BucketProperties(
        lifecycle_rules=[],
        object_lock=BucketObjectLock(enabled=None, mode="GOVERNANCE", days=30, years=1),
        public_access_block=BucketPublicAccessBlock(
            block_public_acls=True,
            ignore_public_acls=False,
            block_public_policy=True,
            restrict_public_buckets=False,
        ),
        cors_rules=[
            {"AllowedMethods": ["GET", "HEAD"], "AllowedOrigins": ["https://example.test"]},
            {"AllowedMethods": ["PUT"], "AllowedOrigins": ["https://upload.test"]},
        ],
    )
    detail_keys = {
        "object_lock_mode",
        "object_lock_retention_days",
        "object_lock_retention_years",
        "bpa_block_public_acls",
        "bpa_ignore_public_acls",
        "bpa_block_public_policy",
        "bpa_restrict_public_buckets",
        "cors_allowed_methods",
        "cors_allowed_origins",
    }
    column_details = {"unrelated": "keep"}

    _project_property_details(_properties_context(properties=properties), detail_keys, column_details)

    assert column_details == {
        "unrelated": "keep",
        "object_lock_mode": "GOVERNANCE",
        "object_lock_retention_days": 30,
        "object_lock_retention_years": 1,
        "bpa_block_public_acls": True,
        "bpa_ignore_public_acls": False,
        "bpa_block_public_policy": True,
        "bpa_restrict_public_buckets": False,
        "cors_allowed_methods": ["GET", "HEAD", "PUT"],
        "cors_allowed_origins": ["https://example.test", "https://upload.test"],
    }


def test_project_property_details_marks_requested_values_unavailable():
    column_details = {"unrelated": "keep"}

    _project_property_details(
        _properties_context(properties=None, unavailable=True),
        {"object_lock_mode", "cors_allowed_methods"},
        column_details,
    )

    assert column_details == {
        "unrelated": "keep",
        "object_lock_mode": None,
        "cors_allowed_methods": None,
    }
