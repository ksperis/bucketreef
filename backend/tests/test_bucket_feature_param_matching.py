# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.models.bucket import BucketObjectLock, BucketProperties, BucketPublicAccessBlock
from app.models.bucket_filter import BucketFilterRule
from app.services.bucket_feature_param_matching import _match_properties_param_rule


@pytest.fixture
def properties() -> BucketProperties:
    return BucketProperties(
        lifecycle_rules=[],
        object_lock=BucketObjectLock(mode="GOVERNANCE", days=30, years=1),
        public_access_block=BucketPublicAccessBlock(
            block_public_acls=True,
            ignore_public_acls=False,
            block_public_policy=True,
            restrict_public_buckets=False,
        ),
        cors_rules=[{"AllowedMethods": ["GET", "HEAD"], "AllowedOrigins": ["https://example.test"]}],
    )


@pytest.mark.parametrize(
    ("feature", "param", "op", "value"),
    [
        ("object_lock", "object_lock_mode", "eq", "governance"),
        ("object_lock", "object_lock_retention_days", "gte", 30),
        ("object_lock", "object_lock_retention_years", "eq", 1),
        ("block_public_access", "bpa_block_public_acls", "eq", True),
        ("block_public_access", "bpa_ignore_public_acls", "eq", False),
        ("block_public_access", "bpa_block_public_policy", "eq", True),
        ("block_public_access", "bpa_restrict_public_buckets", "eq", False),
    ],
)
def test_match_properties_scalar_params(properties, feature, param, op, value):
    rule = BucketFilterRule(feature=feature, param=param, op=op, value=value)

    assert _match_properties_param_rule(rule, properties, op) is True


def test_match_properties_scalar_param_applies_none_quantifier(properties):
    rule = BucketFilterRule(
        feature="object_lock",
        param="object_lock_mode",
        op="eq",
        value="governance",
        quantifier="none",
    )

    assert _match_properties_param_rule(rule, properties, "eq") is False


def test_match_properties_cors_param_uses_validated_rules(properties):
    rule = BucketFilterRule(
        feature="cors",
        param="cors_allowed_method",
        op="has",
        value="GET",
    )

    assert _match_properties_param_rule(rule, properties, "has") is True
