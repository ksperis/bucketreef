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
            "Field rule does not support has/has_not op.",
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
