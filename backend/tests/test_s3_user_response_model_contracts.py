# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.s3_user import (
    S3User,
    S3UserGroupLink,
    S3UserSummary,
    S3UserUpdate,
    S3UserUserLink,
)


def test_s3_user_responses_require_complete_canonical_payloads() -> None:
    assert set(S3UserUserLink.model_json_schema()["required"]) == {
        "allow_manager_browser_data_access",
        "user_id",
        "user_email",
        "user_full_name",
        "user_avatar",
    }
    assert set(S3UserGroupLink.model_json_schema()["required"]) == {
        "allow_manager_browser_data_access",
        "group_id",
        "group_name",
        "group_avatar",
    }
    assert set(S3User.model_json_schema()["required"]) == {
        "id",
        "name",
        "rgw_user_uid",
        "rgw_tenant",
        "email",
        "created_at",
        "user_links",
        "group_links",
        "quota_max_size_gb",
        "quota_max_objects",
        "storage_endpoint_id",
        "storage_endpoint_name",
        "storage_endpoint_url",
        "bucket_count",
        "allow_bucket_quota_management",
        "allow_access_key_management",
        "allow_access_key_metadata",
        "allow_access_key_expiration",
        "allow_activity_history",
        "allow_rgw_usage_metrics",
        "allow_cost_estimation",
        "allow_managed_private_connection_provisioning",
        "tags",
    }
    assert set(S3UserSummary.model_json_schema()["required"]) == {
        "id",
        "name",
        "rgw_user_uid",
        "rgw_tenant",
        "storage_endpoint_id",
        "storage_endpoint_name",
        "storage_endpoint_url",
        "allow_bucket_quota_management",
        "allow_access_key_management",
        "allow_access_key_metadata",
        "allow_access_key_expiration",
        "allow_activity_history",
        "allow_rgw_usage_metrics",
        "allow_cost_estimation",
        "allow_managed_private_connection_provisioning",
        "tags",
    }


def test_s3_user_update_uses_minimal_association_inputs() -> None:
    payload = S3UserUpdate(
        user_links=[{"user_id": 12}],
        group_links=[{"group_id": 34}],
    )
    assert payload.user_links is not None
    assert payload.user_links[0].user_id == 12
    assert payload.user_links[0].allow_manager_browser_data_access is False
    assert payload.group_links is not None
    assert payload.group_links[0].group_id == 34
    assert payload.group_links[0].allow_manager_browser_data_access is False
