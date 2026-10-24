# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest

from app.models.s3_account import AccountGroupLink, AccountUserLink, S3Account
from app.models.tagging import TagDefinitionSummary
from app.services.s3_accounts_service import _account_matches_search


def _searchable_account() -> S3Account:
    return S3Account(
        id=1,
        name="Research Archive",
        rgw_account_id="RGW00000000000000001",
        rgw_tenant="",
        quota_max_size_gb=None,
        quota_max_objects=None,
        email=None,
        used_bytes=None,
        used_objects=None,
        user_links=[
            AccountUserLink(
                manager_role="account_administrator",
                portal_role=None,
                allow_manager_browser_data_access=False,
                user_id=7,
                user_email="alice@example.test",
                user_full_name="Alice Martin",
                user_avatar=None,
            )
        ],
        group_links=[
            AccountGroupLink(
                manager_role="account_administrator",
                portal_role=None,
                allow_manager_browser_data_access=False,
                group_id=3,
                group_name="Platform Operators",
                group_avatar=None,
            )
        ],
        bucket_count=None,
        rgw_user_count=None,
        rgw_user_uids=None,
        rgw_topic_count=None,
        rgw_topics=None,
        storage_endpoint_id=1,
        storage_endpoint_name="Ceph",
        storage_endpoint_url="https://s3.example.test",
        storage_endpoint_is_default=True,
        storage_endpoint_capabilities={"account": True},
        allow_bucket_quota_management=None,
        allow_access_key_metadata=None,
        allow_access_key_expiration=None,
        allow_activity_history=None,
        allow_rgw_usage_metrics=None,
        allow_cost_estimation=None,
        allow_bucket_usage_stats=None,
        allow_bucket_usage_stats_collection=None,
        tags=[
            TagDefinitionSummary(
                id=5,
                label="Critical Data",
                color_key="blue",
                scope="administrative",
            )
        ],
    )


@pytest.mark.parametrize(
    "search_value",
    [
        "research",
        "rgw00000000000000001",
        "critical",
        "alice@example.test",
        "martin",
        "platform",
    ],
)
def test_account_search_matches_all_exposed_search_fields(search_value):
    assert _account_matches_search(_searchable_account(), search_value) is True


def test_account_search_rejects_unmatched_value():
    assert _account_matches_search(_searchable_account(), "missing") is False
