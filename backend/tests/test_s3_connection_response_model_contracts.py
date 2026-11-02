# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.models.s3_connection import (
    S3Connection,
    S3ConnectionUpdate,
    S3ConnectionCredentialsValidationResult,
)
from app.models.s3_connection_admin import (
    S3ConnectionAdminUpdate,
    S3ConnectionAdminItem,
    S3ConnectionGroupDetail,
    S3ConnectionSummary,
)


def test_s3_connection_responses_require_complete_canonical_payloads() -> None:
    assert set(S3Connection.model_json_schema()["required"]) == {
        "id",
        "name",
        "provider_hint",
        "storage_endpoint_id",
        "created_by_user_id",
        "is_shared",
        "is_active",
        "access_manager",
        "access_browser",
        "server_managed",
        "managed_access_state",
        "rgw_user_uid",
        "rgw_tenant",
        "rgw_account_id",
        "endpoint_url",
        "region",
        "access_key_id",
        "force_path_style",
        "verify_tls",
        "capabilities",
        "tags",
        "created_at",
        "updated_at",
        "last_used_at",
    }
    assert set(S3ConnectionGroupDetail.model_json_schema()["required"]) == {
        "id",
        "name",
        "avatar",
    }
    assert set(S3ConnectionAdminItem.model_json_schema()["required"]) == {
        "id",
        "name",
        "storage_endpoint_id",
        "endpoint_url",
        "is_active",
        "execution_status",
        "remediation_reason",
        "rgw_user_uid",
        "rgw_tenant",
        "rgw_account_id",
        "provider_hint",
        "region",
        "force_path_style",
        "verify_tls",
        "allow_activity_history",
        "capabilities",
        "created_by_user_id",
        "created_by_email",
        "created_by_full_name",
        "created_by_avatar",
        "user_count",
        "user_details",
        "group_details",
        "tags",
        "last_used_at",
        "created_at",
        "updated_at",
    }
    assert set(S3ConnectionSummary.model_json_schema()["required"]) == {
        "id",
        "name",
        "created_by_user_id",
        "is_active",
        "execution_status",
    }
    assert set(
        S3ConnectionCredentialsValidationResult.model_json_schema()["required"]
    ) == {"ok", "severity", "code", "message"}


@pytest.mark.parametrize(
    ("model_type", "field_name"),
    [
        *[
            (S3ConnectionUpdate, field)
            for field in (
                "name",
                "is_active",
                "access_manager",
                "access_browser",
                "endpoint_url",
                "access_key_id",
                "secret_access_key",
                "force_path_style",
                "verify_tls",
                "tags",
            )
        ],
        *[
            (S3ConnectionAdminUpdate, field)
            for field in (
                "name",
                "group_ids",
                "user_ids",
                "remediation_action",
                "is_active",
                "endpoint_url",
                "force_path_style",
                "verify_tls",
                "tags",
                "credentials",
            )
        ],
    ],
)
def test_s3_connection_updates_reject_null_for_non_nullable_fields(
    model_type,
    field_name: str,
) -> None:
    with pytest.raises(ValidationError, match=f"{field_name} cannot be null"):
        model_type.model_validate({field_name: None})


@pytest.mark.parametrize("model_type", [S3ConnectionUpdate, S3ConnectionAdminUpdate])
def test_s3_connection_updates_keep_nullable_clear_fields(model_type) -> None:
    payload = model_type.model_validate(
        {
            "storage_endpoint_id": None,
            "provider_hint": None,
            "rgw_user_uid": None,
            "rgw_tenant": None,
            "rgw_account_id": None,
            "region": None,
        }
    )

    assert payload.model_fields_set == {
        "storage_endpoint_id",
        "provider_hint",
        "rgw_user_uid",
        "rgw_tenant",
        "rgw_account_id",
        "region",
    }


def test_admin_connection_update_keeps_nullable_feature_override() -> None:
    payload = S3ConnectionAdminUpdate(allow_activity_history=None)

    assert payload.allow_activity_history is None
    assert payload.model_fields_set == {"allow_activity_history"}
