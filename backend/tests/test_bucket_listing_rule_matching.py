# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.models.bucket import BucketFeatureStatus, BucketTag
from app.models.bucket_filter import BucketFilterRule
from app.models.bucket_listing import BucketListingSummary
from app.services.bucket_listing_rule_matching import (
    match_bucket_feature_rule,
    match_bucket_field_rule,
)


def _bucket(feature: str, state: str, tone: str) -> BucketListingSummary:
    return BucketListingSummary(
        name="bucket-a",
        features={feature: BucketFeatureStatus(state=state, tone=tone)},
    )


@pytest.mark.parametrize(
    ("feature", "state", "tone", "desired", "matched"),
    [
        ("versioning", "Enabled", "active", "enabled", True),
        ("versioning", "Disabled", "inactive", "disabled", True),
        ("versioning", "Suspended", "inactive", "disabled", False),
        ("versioning", "Suspended", "inactive", "disabled_or_suspended", True),
        ("versioning", "Suspended", "inactive", "suspended", True),
        ("notifications", "Suspended", "inactive", "disabled", True),
        ("notifications", "Configured", "active", "configured", True),
        ("notifications", "Not set", "inactive", "not_set", True),
        ("notifications", "Partial", "unknown", "partial", True),
        ("notifications", "Unavailable", "unknown", "unavailable", True),
        ("notifications", "Unknown", "unknown", "unknown", True),
        ("notifications", "Configured", "active", "disabled", False),
    ],
)
def test_match_bucket_feature_rule_uses_canonical_feature_states(
    feature,
    state,
    tone,
    desired,
    matched,
):
    rule = BucketFilterRule.model_validate({"feature": feature, "state": desired})
    assert match_bucket_feature_rule(_bucket(feature, state, tone), rule) is matched


@pytest.mark.parametrize("desired", ["unknown", "unavailable"])
def test_match_bucket_feature_rule_treats_missing_feature_as_unknown_or_unavailable(desired):
    rule = BucketFilterRule.model_validate({"feature": "versioning", "state": desired})
    assert match_bucket_feature_rule(BucketListingSummary(name="bucket-a"), rule)


@pytest.mark.parametrize("legacy_state", ["active", "inactive"])
def test_bucket_feature_filter_contract_rejects_legacy_state_aliases(legacy_state):
    with pytest.raises(ValidationError):
        BucketFilterRule.model_validate({"feature": "versioning", "state": legacy_state})


@pytest.mark.parametrize(
    ("op", "value", "matched"),
    [
        ("contains", "env=pro", True),
        ("contains", "prod", True),
        ("starts_with", "en=pr", True),
        ("ends_with", "ment=od", True),
        ("eq", "environment=prod", True),
        ("eq", "environment:prod", True),
        ("neq", "environment=stage", True),
        ("neq", "environment=prod", False),
        ("in", ["owner=other", "environment=prod"], True),
        ("not_in", ["owner=other"], True),
        ("not_in", ["environment=prod"], False),
        ("contains", "", False),
    ],
)
def test_match_bucket_tag_rule_normalizes_tag_expressions(op, value, matched):
    bucket = BucketListingSummary(
        name="bucket-a",
        tags=[BucketTag(key="environment", value="prod")],
    )
    rule = BucketFilterRule.model_validate({"field": "tag", "op": op, "value": value})

    assert match_bucket_field_rule(bucket, rule) is matched


def test_match_bucket_tag_rule_requires_tags():
    rule = BucketFilterRule.model_validate(
        {"field": "tag", "op": "contains", "value": "environment=prod"}
    )
    assert not match_bucket_field_rule(BucketListingSummary(name="bucket-a"), rule)
