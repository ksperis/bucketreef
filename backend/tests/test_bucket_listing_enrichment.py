# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.models.bucket import BucketWebsiteConfiguration, BucketWebsiteRedirectAllRequestsTo
from app.models.bucket_listing import BucketListingSummary
from app.services.bucket_listing_enrichment import _enrich_website_configuration
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
