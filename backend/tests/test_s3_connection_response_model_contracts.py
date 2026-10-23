# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.s3_connection import (
    S3Connection,
    S3ConnectionCredentialsValidationResult,
)
from app.models.s3_connection_admin import (
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
