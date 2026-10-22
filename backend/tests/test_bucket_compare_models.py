# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import re

import pytest
from pydantic import ValidationError

from app.models.ceph_admin import CephAdminBucketCompareRequest
from app.models.manager_bucket_compare import ManagerBucketCompareRequest


COMPARE_REQUEST_MODELS = [
    pytest.param(
        CephAdminBucketCompareRequest,
        {"target_endpoint_id": 2},
        id="ceph-admin",
    ),
    pytest.param(
        ManagerBucketCompareRequest,
        {"target_context_id": " target-context "},
        id="manager",
    ),
]


@pytest.mark.parametrize(("model_type", "target_payload"), COMPARE_REQUEST_MODELS)
def test_compare_requests_share_scope_normalization(model_type, target_payload):
    bucket_payload = (
        {
            "source": {"name": " source-bucket "},
            "target": {"name": " target-bucket "},
        }
        if model_type is CephAdminBucketCompareRequest
        else {
            "source_bucket": " source-bucket ",
            "target_bucket": " target-bucket ",
        }
    )
    request = model_type.model_validate(
        {
            **target_payload,
            **bucket_payload,
            "include_config": True,
            "config_features": ["tags", "versioning_status", "tags"],
        }
    )

    if isinstance(request, CephAdminBucketCompareRequest):
        assert request.source.name == "source-bucket"
        assert request.target.name == "target-bucket"
    else:
        assert request.source_bucket == "source-bucket"
        assert request.target_bucket == "target-bucket"
    assert request.config_features == ["tags", "versioning_status"]
    if isinstance(request, ManagerBucketCompareRequest):
        assert request.target_context_id == "target-context"


@pytest.mark.parametrize(("model_type", "target_payload"), COMPARE_REQUEST_MODELS)
def test_compare_requests_reject_an_empty_comparison_scope(model_type, target_payload):
    message = "At least one comparison scope must be enabled."
    bucket_payload = (
        {
            "source": {"name": "source-bucket"},
            "target": {"name": "target-bucket"},
        }
        if model_type is CephAdminBucketCompareRequest
        else {
            "source_bucket": "source-bucket",
            "target_bucket": "target-bucket",
        }
    )

    with pytest.raises(ValidationError, match=re.escape(message)):
        model_type.model_validate(
            {
                **target_payload,
                **bucket_payload,
                "include_content": False,
                "include_config": False,
            }
        )
