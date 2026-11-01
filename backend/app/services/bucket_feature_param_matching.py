# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.bucket_filter import BucketFilterRule
from app.services.bucket_feature_grouped_param_matching import (
    grouped_feature_names,
    grouped_feature_param_source,
    grouped_feature_source,
    match_grouped_feature_param_rules,
)
from app.services.bucket_feature_scalar_param_matching import match_scalar_feature_param_rule


FEATURE_PARAM_UNAVAILABLE = object()
_SCALAR_FEATURE_PARAM_SOURCE_BY_PARAM: dict[str, str] = {
    "object_lock_mode": "props",
    "object_lock_retention_days": "props",
    "object_lock_retention_years": "props",
    "bpa_block_public_acls": "props",
    "bpa_ignore_public_acls": "props",
    "bpa_block_public_policy": "props",
    "bpa_restrict_public_buckets": "props",
    "logging_enabled": "logging",
    "logging_target_bucket": "logging",
    "logging_target_prefix": "logging",
    "website_index_present": "website",
    "website_index_document": "website",
    "website_error_document": "website",
    "website_redirect_host_present": "website",
    "website_redirect_host": "website",
    "website_routing_rule_count": "website",
    "policy_statement_count": "policy",
    "policy_has_conditions": "policy",
    "notification_eventbridge_present": "notifications",
}


def _feature_param_source(rule: BucketFilterRule) -> str | None:
    if not rule.feature or not rule.param:
        return None
    grouped_source = grouped_feature_param_source(rule.feature, rule.param)
    if grouped_source:
        return grouped_source
    return _SCALAR_FEATURE_PARAM_SOURCE_BY_PARAM.get(rule.param)


def _match_scalar_param_rule(rule: BucketFilterRule, snapshot: dict[str, object]) -> bool:
    if not rule.feature or not rule.param or not (rule.op or "").strip():
        return False
    source = _SCALAR_FEATURE_PARAM_SOURCE_BY_PARAM.get(rule.param)
    if source is None:
        return False
    source_data = snapshot.get(source, FEATURE_PARAM_UNAVAILABLE)
    if source_data is FEATURE_PARAM_UNAVAILABLE:
        return False
    return match_scalar_feature_param_rule(rule, source, source_data)


def match_bucket_feature_param_rules(
    rules: list[BucketFilterRule],
    match_mode: str,
    snapshot: dict[str, object],
) -> bool:
    if not rules:
        return True

    grouped_rules = {feature: [] for feature in grouped_feature_names()}
    scalar_rules: list[BucketFilterRule] = []
    for rule in rules:
        feature = rule.feature or ""
        param = rule.param or ""
        if grouped_feature_param_source(feature, param):
            grouped_rules[feature].append(rule)
        else:
            scalar_rules.append(rule)

    results: list[bool] = []
    for feature, feature_rules in grouped_rules.items():
        if not feature_rules:
            continue
        source = grouped_feature_source(feature)
        source_data = snapshot.get(source, FEATURE_PARAM_UNAVAILABLE) if source else FEATURE_PARAM_UNAVAILABLE
        results.append(
            False
            if source_data is FEATURE_PARAM_UNAVAILABLE
            else match_grouped_feature_param_rules(
                feature,
                feature_rules,
                match_mode,
                source_data,
            )
        )

    results.extend(_match_scalar_param_rule(rule, snapshot) for rule in scalar_rules)
    return all(results) if match_mode == "all" else any(results)


def required_feature_param_sources(rules: list[BucketFilterRule]) -> set[str]:
    return {
        source
        for rule in rules
        if (source := _feature_param_source(rule)) is not None
    }
