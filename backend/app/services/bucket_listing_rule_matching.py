# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.bucket_filter import BucketFilterQuery, BucketFilterRule
from app.models.bucket_listing import BucketListingSummary
from app.services.bucket_listing_owner_metadata import (
    OWNER_DETAIL_FIELDS,
    normalize_owner_kind,
    normalize_owner_kind_scalar,
)
from app.services.bucket_listing_shared import (
    coerce_filter_bool,
    coerce_filter_number,
    filter_requires_stats,
)
from app.services.listing_rule_matching import (
    match_boolean_rule,
    match_numeric_rule,
    match_text_rule,
)
from app.services.rgw_bucket_metadata import owner_kind_from_owner
from app.utils.usage_stats import compute_usage_ratio_percent

EXPENSIVE_FIELD_RULES = {"tag"} | OWNER_DETAIL_FIELDS
_TAG_FILTER_OPS = frozenset({"eq", "neq", "contains", "starts_with", "ends_with", "in", "not_in"})
_TAG_TEXT_MATCHERS = {
    "eq": lambda value, candidate: value == candidate,
    "contains": lambda value, candidate: candidate in value,
    "starts_with": lambda value, candidate: value.startswith(candidate),
    "ends_with": lambda value, candidate: value.endswith(candidate),
}
_NEGATED_TAG_OPS = frozenset({"neq", "not_in"})
_EXACT_FEATURE_STATES = frozenset(
    {"partial", "suspended", "configured", "not_set", "unavailable"}
)


def _exact_name_rule_values(rule: BucketFilterRule) -> set[str] | None:
    if rule.op == "in" and isinstance(rule.value, list):
        return {
            value
            for item in rule.value
            if (value := str(item or "").strip())
        }
    if rule.op == "eq" and rule.value is not None:
        value = str(rule.value).strip()
        return {value} if value else set()
    return None


def extract_name_candidates(query: BucketFilterQuery | None) -> list[str] | None:
    if not query or not query.rules:
        return None

    exact_rules: list[set[str]] = []
    for rule in query.rules:
        if rule.field != "name":
            if query.match == "any":
                return None
            continue
        values = _exact_name_rule_values(rule)
        if values is None:
            if query.match == "any":
                return None
            continue
        exact_rules.append(values)

    if not exact_rules:
        return None
    candidates = set(exact_rules[0])
    for values in exact_rules[1:]:
        candidates = candidates & values if query.match == "all" else candidates | values
    return sorted(candidates)


def _match_tag_expression(tag_key: str, tag_value: str, expression: str, op: str) -> bool:
    expr = expression.strip().lower()
    if not expr:
        return False
    key = tag_key.strip().lower()
    value = tag_value.strip().lower()
    matcher = _TAG_TEXT_MATCHERS.get(op, _TAG_TEXT_MATCHERS["eq"])
    sep = "=" if "=" in expr else (":" if ":" in expr else None)
    if sep:
        expr_key, expr_value = expr.split(sep, 1)
        expr_key = expr_key.strip()
        expr_value = expr_value.strip()
        return matcher(key, expr_key) and matcher(value, expr_value)
    return matcher(key, expr) or matcher(value, expr)


def _tag_rule_expressions(rule: BucketFilterRule) -> tuple[list[str], str]:
    op = rule.op or "contains"
    if op in {"in", "not_in"}:
        values = rule.value if isinstance(rule.value, list) else []
        match_op = "eq"
    else:
        values = [rule.value]
        match_op = "eq" if op == "neq" else op
    expressions = [str(item or "").strip() for item in values]
    return [expression for expression in expressions if expression], match_op


def _match_tag_rule(bucket: BucketListingSummary, rule: BucketFilterRule) -> bool:
    tags = bucket.tags or []
    if not tags:
        return False
    op = rule.op or "contains"
    if op not in _TAG_FILTER_OPS:
        return False
    expressions, match_op = _tag_rule_expressions(rule)
    if not expressions:
        return False
    matched = any(
        _match_tag_expression(tag.key, tag.value, expression, match_op)
        for tag in tags
        for expression in expressions
    )
    return not matched if op in _NEGATED_TAG_OPS else matched


def match_bucket_field_rule(bucket: BucketListingSummary, rule: BucketFilterRule) -> bool:
    field = rule.field
    op = rule.op
    if not field or not op:
        return False
    if field == "tag":
        return _match_tag_rule(bucket, rule)
    if field == "owner_kind":
        value = owner_kind_from_owner(bucket.owner)
    elif field == "quota_usage_size_percent":
        value = compute_usage_ratio_percent(bucket.used_bytes, bucket.quota_max_size_bytes)
    elif field == "quota_usage_object_percent":
        value = compute_usage_ratio_percent(bucket.object_count, bucket.quota_max_objects)
    elif field == "owner_quota_usage_size_percent":
        value = compute_usage_ratio_percent(bucket.owner_used_bytes, bucket.owner_quota_max_size_bytes)
    elif field == "owner_quota_usage_object_percent":
        value = compute_usage_ratio_percent(bucket.owner_object_count, bucket.owner_quota_max_objects)
    else:
        value = getattr(bucket, field, None)
    if op == "is_null":
        return value is None
    if op == "not_null":
        return value is not None
    if field == "owner_suspended":
        return match_boolean_rule(
            value,
            op,
            rule.value,
            coerce=coerce_filter_bool,
            default_if_none=False,
        )
    if value is None:
        return False

    string_fields = {
        "name",
        "tenant",
        "owner",
        "owner_name",
        "owner_kind",
        "context_id",
        "context_name",
        "context_kind",
        "endpoint_name",
        "bucket_identity",
    }
    if field in string_fields:
        if field == "owner_kind":
            return match_text_rule(
                value,
                op,
                rule.value,
                scalar_normalizer=normalize_owner_kind_scalar,
                candidate_normalizer=normalize_owner_kind,
                require_candidates=True,
            )
        return match_text_rule(value, op, rule.value)

    return match_numeric_rule(
        value,
        op,
        rule.value,
        coerce=coerce_filter_number,
    )


def _matches_disabled_feature(feature: str, state: str, tone: str) -> bool:
    if feature == "versioning":
        # Keep disabled distinct from suspended for versioning filters.
        return state == "disabled" or (tone == "inactive" and state != "suspended")
    return tone == "inactive" or state == "suspended"


def _matches_disabled_or_suspended_feature(feature: str, state: str, tone: str) -> bool:
    if feature == "versioning":
        return state in {"disabled", "suspended"} or tone == "inactive"
    return _matches_disabled_feature(feature, state, tone)


def match_bucket_feature_rule(bucket: BucketListingSummary, rule: BucketFilterRule) -> bool:
    feature = rule.feature
    desired = (rule.state or "").strip().lower()
    if not feature or not desired:
        return False
    status = (bucket.features or {}).get(feature)
    if status is None:
        return desired in {"unknown", "unavailable"}
    state_norm = status.state.strip().lower().replace(" ", "_")
    if desired == "enabled":
        return status.tone == "active"
    if desired == "disabled":
        return _matches_disabled_feature(feature, state_norm, status.tone)
    if desired == "disabled_or_suspended":
        return _matches_disabled_or_suspended_feature(feature, state_norm, status.tone)
    if desired == "unknown":
        return status.tone == "unknown"
    return desired in _EXACT_FEATURE_STATES and state_norm == desired


def request_requires_bucket_stats(query: BucketFilterQuery | None, sort_by: str) -> bool:
    return sort_by in {"used_bytes", "object_count"} or filter_requires_stats(query)
