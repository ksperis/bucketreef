# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.main import app
from app.models.bucket_integrity import (
    BucketIntegrityBucketRequest,
    BucketIntegrityTargetRequest,
)
from app.models.bucket_operation import BucketOperationTarget
from app.models.bucket_purge import BucketPurgeBucketRequest, BucketPurgeTargetRequest
from app.models.bucket_usage_stats import (
    BucketUsageStatsBucketRequest,
    BucketUsageStatsTargetRequest,
)


def test_bucket_operation_target_normalization():
    target = BucketOperationTarget(context_id=" account-1 ", bucket_name=" bucket-1 ")

    assert target.context_id == "account-1"
    assert target.bucket_name == "bucket-1"


@pytest.mark.parametrize(
    "payload",
    [
        {"context_id": " ", "bucket_name": "bucket-1"},
        {"context_id": "account-1", "bucket_name": " "},
        {"context_id": "", "bucket_name": "bucket-1"},
    ],
)
def test_bucket_operation_target_requires_both_fields(payload):
    with pytest.raises(ValidationError):
        BucketOperationTarget.model_validate(payload)


@pytest.mark.parametrize(
    ("request_type", "extra"),
    [
        (BucketIntegrityBucketRequest, {}),
        (BucketPurgeBucketRequest, {"confirmation": "PURGE 1 BUCKETS"}),
        (BucketUsageStatsBucketRequest, {}),
    ],
)
def test_bucket_requests_share_name_normalization(request_type, extra):
    request = request_type(buckets=[" bucket-1 ", "bucket-1", " "], **extra)

    assert request.buckets == ["bucket-1"]


@pytest.mark.parametrize(
    ("request_type", "extra"),
    [
        (BucketIntegrityTargetRequest, {}),
        (BucketPurgeTargetRequest, {"confirmation": "PURGE 1 BUCKETS"}),
        (BucketUsageStatsTargetRequest, {}),
    ],
)
def test_target_requests_share_deduplication(request_type, extra):
    target = BucketOperationTarget(context_id="account-1", bucket_name="bucket-1")
    request = request_type(targets=[target, target.model_copy()], **extra)

    assert request.targets == [target]


@pytest.mark.parametrize(
    ("request_type", "valid_payload", "forbidden_field", "forbidden_value"),
    [
        (BucketIntegrityBucketRequest, {"buckets": ["bucket-1"]}, "targets", [{"context_id": "account-1", "bucket_name": "bucket-1"}]),
        (BucketIntegrityTargetRequest, {"targets": [{"context_id": "account-1", "bucket_name": "bucket-1"}]}, "buckets", ["bucket-1"]),
        (BucketPurgeBucketRequest, {"buckets": ["bucket-1"], "confirmation": "PURGE 1 BUCKETS"}, "targets", [{"context_id": "account-1", "bucket_name": "bucket-1"}]),
        (BucketPurgeTargetRequest, {"targets": [{"context_id": "account-1", "bucket_name": "bucket-1"}], "confirmation": "PURGE 1 BUCKETS"}, "buckets", ["bucket-1"]),
        (BucketUsageStatsBucketRequest, {"buckets": ["bucket-1"]}, "targets", [{"context_id": "account-1", "bucket_name": "bucket-1"}]),
        (BucketUsageStatsTargetRequest, {"targets": [{"context_id": "account-1", "bucket_name": "bucket-1"}]}, "buckets", ["bucket-1"]),
    ],
)
def test_bucket_operation_requests_expose_only_their_surface_target_shape(
    request_type,
    valid_payload,
    forbidden_field,
    forbidden_value,
):
    request_type.model_validate(valid_payload)

    with pytest.raises(ValidationError):
        request_type.model_validate({**valid_payload, forbidden_field: forbidden_value})


@pytest.mark.parametrize(
    "request_type",
    [
        BucketIntegrityBucketRequest,
        BucketIntegrityTargetRequest,
        BucketPurgeBucketRequest,
        BucketPurgeTargetRequest,
        BucketUsageStatsBucketRequest,
        BucketUsageStatsTargetRequest,
    ],
)
def test_bucket_operation_requests_require_a_target_collection(request_type):
    with pytest.raises(ValidationError):
        request_type.model_validate({})


def test_purge_requests_validate_confirmation_against_selected_targets():
    with pytest.raises(ValidationError, match="PURGE 2 BUCKETS"):
        BucketPurgeBucketRequest(
            buckets=["bucket-1", "bucket-2"],
            confirmation="PURGE 1 BUCKETS",
        )

    with pytest.raises(ValidationError, match="PURGE 2 BUCKETS"):
        BucketPurgeTargetRequest(
            targets=[
                {"context_id": "account-1", "bucket_name": "bucket-1"},
                {"context_id": "account-2", "bucket_name": "bucket-2"},
            ],
            confirmation="PURGE 1 BUCKETS",
        )


def test_bucket_operation_openapi_models_are_surface_specific():
    schemas = app.openapi()["components"]["schemas"]

    for request_name in (
        "BucketIntegrityBucketRequest",
        "BucketPurgeBucketRequest",
        "BucketUsageStatsBucketRequest",
    ):
        properties = schemas[request_name]["properties"]
        assert "buckets" in properties
        assert "targets" not in properties

    for request_name in (
        "BucketIntegrityTargetRequest",
        "BucketPurgeTargetRequest",
        "BucketUsageStatsTargetRequest",
    ):
        properties = schemas[request_name]["properties"]
        assert "targets" in properties
        assert "buckets" not in properties
        assert properties["targets"]["items"] == {
            "$ref": "#/components/schemas/BucketOperationTarget"
        }
