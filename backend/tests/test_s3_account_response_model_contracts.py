# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.s3_account import (
    AccountGroupLink,
    AccountUserLink,
    S3Account,
    S3AccountSummary,
    S3AccountUpdate,
)


def test_s3_account_responses_require_complete_canonical_payloads() -> None:
    assert set(AccountUserLink.model_json_schema()["required"]) == {
        "manager_role",
        "portal_role",
        "allow_manager_browser_data_access",
        "user_id",
        "user_email",
        "user_full_name",
        "user_avatar",
    }
    assert set(AccountGroupLink.model_json_schema()["required"]) == {
        "manager_role",
        "portal_role",
        "allow_manager_browser_data_access",
        "group_id",
        "group_name",
        "group_avatar",
    }
    assert set(S3Account.model_json_schema()["required"]) == {
        "id",
        "name",
        "rgw_account_id",
        "rgw_tenant",
        "quota_max_size_gb",
        "quota_max_objects",
        "email",
        "used_bytes",
        "used_objects",
        "user_links",
        "group_links",
        "bucket_count",
        "rgw_user_count",
        "rgw_user_uids",
        "rgw_topic_count",
        "rgw_topics",
        "storage_endpoint_id",
        "storage_endpoint_name",
        "storage_endpoint_url",
        "storage_endpoint_is_default",
        "storage_endpoint_capabilities",
        "allow_bucket_quota_management",
        "allow_access_key_metadata",
        "allow_access_key_expiration",
        "allow_activity_history",
        "allow_rgw_usage_metrics",
        "allow_cost_estimation",
        "allow_bucket_usage_stats",
        "allow_bucket_usage_stats_collection",
        "tags",
    }
    assert set(S3AccountSummary.model_json_schema()["required"]) == {
        "id",
        "name",
        "rgw_account_id",
        "rgw_tenant",
        "user_links",
        "group_links",
        "storage_endpoint_id",
        "storage_endpoint_name",
        "storage_endpoint_url",
        "storage_endpoint_is_default",
        "storage_endpoint_capabilities",
        "allow_bucket_quota_management",
        "allow_access_key_metadata",
        "allow_access_key_expiration",
        "allow_activity_history",
        "allow_rgw_usage_metrics",
        "allow_cost_estimation",
        "allow_bucket_usage_stats",
        "allow_bucket_usage_stats_collection",
        "tags",
    }


def test_s3_account_update_uses_minimal_association_inputs() -> None:
    payload = S3AccountUpdate(
        user_links=[
            {
                "user_id": 12,
                "manager_role": "account_administrator",
                "portal_role": None,
            }
        ],
        group_links=[
            {
                "group_id": 34,
                "manager_role": None,
                "portal_role": "portal_user",
            }
        ],
    )
    assert payload.user_links is not None
    assert payload.user_links[0].user_id == 12
    assert payload.user_links[0].allow_manager_browser_data_access is False
    assert payload.group_links is not None
    assert payload.group_links[0].group_id == 34
    assert payload.group_links[0].allow_manager_browser_data_access is False
