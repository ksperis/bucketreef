# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import pytest
from pydantic import ValidationError

from app.models.bucket_filter import BucketFilterRule


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({}, "Rule must define exactly one of field or feature."),
        (
            {"field": "name", "feature": "versioning", "op": "eq", "value": "bucket-a", "state": "enabled"},
            "Rule must define exactly one of field or feature.",
        ),
        ({"field": "name", "value": "bucket-a"}, "Field rule requires op."),
        (
            {"field": "name", "op": "has", "value": "bucket-a"},
            "Bucket field 'name' does not support op 'has'.",
        ),
        ({"field": "name", "op": "eq"}, "Field rule requires value."),
        (
            {"field": "name", "op": "eq", "value": "bucket-a", "state": "enabled"},
            "Field rule cannot define state or param.",
        ),
        (
            {"field": "name", "op": "eq", "value": "bucket-a", "quantifier": "none"},
            "Field rule quantifier must be omitted or 'any'.",
        ),
        ({"feature": "versioning"}, "Feature rule requires exactly one of state or param."),
        (
            {"feature": "versioning", "state": "enabled", "op": "eq"},
            "Feature state rule cannot define op or value.",
        ),
        (
            {"feature": "versioning", "state": "enabled", "quantifier": "none"},
            "Feature state rule quantifier must be omitted or 'any'.",
        ),
        (
            {"feature": "bucket_policy", "param": "policy_statement_count"},
            "Feature param rule requires op.",
        ),
    ],
)
def test_bucket_filter_rule_rejects_invalid_shapes(payload, message):
    with pytest.raises(ValidationError, match=message.replace(".", r"\.")):
        BucketFilterRule.model_validate(payload)


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {"field": "name", "op": "gt", "value": "bucket-a"},
            "Bucket field 'name' does not support op 'gt'.",
        ),
        (
            {"field": "owner_suspended", "op": "contains", "value": True},
            "Bucket field 'owner_suspended' does not support op 'contains'.",
        ),
        (
            {"field": "used_bytes", "op": "contains", "value": 10},
            "Bucket field 'used_bytes' does not support op 'contains'.",
        ),
        (
            {"field": "tag", "op": "gte", "value": "env=prod"},
            "Bucket field 'tag' does not support op 'gte'.",
        ),
        (
            {"field": "name", "op": "in", "value": "bucket-a"},
            "Field rule in/not_in op requires a list value.",
        ),
        (
            {"field": "name", "op": "eq", "value": ["bucket-a"]},
            "Field rule scalar op does not accept a list value.",
        ),
        (
            {"field": "tenant", "op": "is_null", "value": "legacy"},
            "Null-check field rule does not accept value.",
        ),
    ],
)
def test_bucket_filter_field_rule_rejects_unsupported_operator_and_value_shapes(payload, message):
    with pytest.raises(ValidationError, match=message.replace(".", r"\.")):
        BucketFilterRule.model_validate(payload)


def test_feature_param_rule_defaults_to_any_quantifier():
    rule = BucketFilterRule.model_validate(
        {
            "feature": "lifecycle_rules",
            "param": "lifecycle_abort_multipart_present",
            "op": "has",
        }
    )

    assert rule.quantifier == "any"


def test_feature_param_rule_preserves_none_quantifier():
    rule = BucketFilterRule.model_validate(
        {
            "feature": "notifications",
            "param": "notification_event",
            "op": "has_not",
            "value": "s3:ObjectCreated:*",
            "quantifier": "none",
        }
    )

    assert rule.quantifier == "none"


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {
                "feature": "cors",
                "param": "notification_event",
                "op": "has",
                "value": "s3:ObjectCreated:*",
            },
            "Feature param 'notification_event' is invalid for feature 'cors'.",
        ),
        (
            {
                "feature": "bucket_policy",
                "param": "policy_statement_count",
                "op": "contains",
                "value": 2,
            },
            "Feature param 'policy_statement_count' does not support op 'contains'.",
        ),
        (
            {
                "feature": "server_side_encryption",
                "param": "sse_algorithm",
                "op": "eq",
            },
            "Feature param rule requires value.",
        ),
        (
            {
                "feature": "lifecycle_rules",
                "param": "lifecycle_abort_multipart_present",
                "op": "has",
                "value": True,
            },
            "Feature param rule does not accept value.",
        ),
    ],
)
def test_feature_param_rule_rejects_contract_violations(payload, message):
    with pytest.raises(ValidationError, match=message.replace(".", r"\.")):
        BucketFilterRule.model_validate(payload)


def test_feature_param_rule_rejects_list_value():
    with pytest.raises(ValidationError, match="Feature param rule requires a scalar value\\."):
        BucketFilterRule.model_validate(
            {
                "feature": "server_side_encryption",
                "param": "sse_algorithm",
                "op": "eq",
                "value": ["AES256"],
            }
        )
