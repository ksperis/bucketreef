# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.ceph_admin import (
    CephAdminAdminOpsResult,
    CephAdminBucketCompareResult,
    CephAdminBucketUsagePoint,
    CephAdminClusterOwnerUsagePoint,
    CephAdminClusterStorageMetrics,
    CephAdminClusterStorageTotals,
    CephAdminEndpointAccess,
    CephAdminEntityMetrics,
    CephAdminRgwAccountDetail,
    CephAdminRgwUserCreateResponse,
    CephAdminRgwUserDetail,
)


def test_ceph_admin_core_responses_require_complete_canonical_payloads() -> None:
    assert set(CephAdminEndpointAccess.model_json_schema()["required"]) == {
        "endpoint_id",
        "can_admin",
        "can_accounts",
        "can_metrics",
        "admin_warning",
        "accounts_warning",
        "active_rgw_uid",
        "active_rgw_tenant",
        "availability_status",
        "availability_checked_at",
    }
    assert set(CephAdminAdminOpsResult.model_json_schema()["required"]) == {
        "operation",
        "success",
        "rgw_status_code",
        "rgw_error_code",
        "message",
        "result",
    }
    assert set(CephAdminRgwAccountDetail.model_json_schema()["required"]) == {
        "account_id",
        "tenant",
        "account_name",
        "email",
        "max_users",
        "max_buckets",
        "max_roles",
        "max_groups",
        "max_access_keys",
        "bucket_count",
        "user_count",
        "quota",
        "bucket_quota",
    }
    assert set(CephAdminRgwUserDetail.model_json_schema()["required"]) == {
        "uid",
        "tenant",
        "display_name",
        "email",
        "account_id",
        "account_name",
        "suspended",
        "admin",
        "system",
        "account_root",
        "max_buckets",
        "op_mask",
        "default_placement",
        "default_storage_class",
        "caps",
        "quota",
        "keys",
    }
    assert set(CephAdminRgwUserCreateResponse.model_json_schema()["required"]) == {
        "detail",
        "generated_key",
    }


def test_ceph_admin_metric_responses_require_complete_canonical_payloads() -> None:
    assert set(CephAdminBucketUsagePoint.model_json_schema()["required"]) == {
        "name",
        "used_bytes",
        "object_count",
    }
    assert set(CephAdminEntityMetrics.model_json_schema()["required"]) == {
        "total_bytes",
        "total_objects",
        "bucket_count",
        "bucket_usage",
        "generated_at",
    }
    assert set(CephAdminClusterOwnerUsagePoint.model_json_schema()["required"]) == {
        "owner",
        "used_bytes",
        "object_count",
        "bucket_count",
    }
    assert set(CephAdminClusterStorageTotals.model_json_schema()["required"]) == {
        "used_bytes",
        "object_count",
        "bucket_count",
        "owners_with_usage",
    }
    assert set(CephAdminClusterStorageMetrics.model_json_schema()["required"]) == {
        "total_buckets",
        "bucket_usage",
        "owner_usage",
        "storage_totals",
        "generated_at",
    }


def test_ceph_admin_compare_response_requires_complete_canonical_payload() -> None:
    assert set(CephAdminBucketCompareResult.model_json_schema()["required"]) == {
        "source_endpoint_id",
        "target_endpoint_id",
        "source_bucket",
        "target_bucket",
        "source_tenant",
        "target_tenant",
        "has_differences",
        "content_diff",
        "config_diff",
    }
