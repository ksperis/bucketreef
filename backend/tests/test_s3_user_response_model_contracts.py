# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.models.s3_user import (
    S3User,
    S3UserCreate,
    S3UserGroupLink,
    S3UserGroupLinkInput,
    S3UserSummary,
    S3UserUpdate,
    S3UserUserLink,
    S3UserUserLinkInput,
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
        "allow_bucket_usage_stats",
        "allow_bucket_usage_stats_collection",
        "allow_multisite_endpoint_switching",
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
        "allow_bucket_usage_stats",
        "allow_bucket_usage_stats_collection",
        "allow_multisite_endpoint_switching",
        "allow_managed_private_connection_provisioning",
        "tags",
    }


def test_s3_user_create_requires_explicit_rgw_tenant() -> None:
    payload = {"name": "example", "storage_endpoint_id": 1}
    with pytest.raises(ValidationError):
        S3UserCreate.model_validate(payload)
    with pytest.raises(ValidationError):
        S3UserCreate.model_validate({**payload, "rgw_tenant": None})
    assert S3UserCreate.model_validate({**payload, "rgw_tenant": ""}).rgw_tenant == ""


def test_s3_user_update_uses_minimal_association_inputs() -> None:
    payload = S3UserUpdate(
        user_links=[{"user_id": 12, "allow_manager_browser_data_access": False}],
        group_links=[{"group_id": 34, "allow_manager_browser_data_access": False}],
    )
    assert payload.user_links is not None
    assert payload.user_links[0].user_id == 12
    assert payload.user_links[0].allow_manager_browser_data_access is False
    assert payload.group_links is not None
    assert payload.group_links[0].group_id == 34
    assert payload.group_links[0].allow_manager_browser_data_access is False


@pytest.mark.parametrize("field_name", ["name", "user_links", "group_links", "tags"])
def test_s3_user_update_rejects_null_for_non_nullable_fields(field_name: str) -> None:
    with pytest.raises(ValidationError, match=f"{field_name} cannot be null"):
        S3UserUpdate.model_validate({field_name: None})


def test_s3_user_update_keeps_explicit_nullable_email() -> None:
    payload = S3UserUpdate(email=None)

    assert payload.email is None
    assert payload.model_fields_set == {"email"}


@pytest.mark.parametrize(
    ("model_type", "payload"),
    [
        (S3UserUserLinkInput, {"user_id": 12}),
        (S3UserGroupLinkInput, {"group_id": 34}),
    ],
)
def test_s3_user_association_inputs_require_explicit_browser_access(
    model_type,
    payload,
) -> None:
    with pytest.raises(ValidationError):
        model_type.model_validate(payload)
    with pytest.raises(ValidationError):
        model_type.model_validate({**payload, "allow_manager_browser_data_access": None})
