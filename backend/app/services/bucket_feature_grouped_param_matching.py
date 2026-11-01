# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, TypeVar

from app.models.bucket import BucketProperties
from app.models.bucket_filter import BucketFilterRule
from app.services.bucket_feature_param_predicates import (
    feature_param_quantifier,
    match_numeric_value,
    match_text_value,
)
from app.services.bucket_feature_param_values import (
    encryption_rule_entries,
    extract_cors_rule_values,
    extract_lifecycle_abort_days,
    extract_lifecycle_expiration_days,
    extract_lifecycle_noncurrent_expiration_days,
    extract_lifecycle_transition_days,
    extract_notification_events,
    extract_notification_filter_values,
    extract_notification_rule_id,
    extract_notification_topic_match_values,
    extract_sse_rule_values,
    notification_rule_entries,
)


_LIFECYCLE_PARAMS = frozenset(
    {
        "lifecycle_rule_id",
        "lifecycle_rule_status",
        "lifecycle_rule_type",
        "lifecycle_expiration_days",
        "lifecycle_noncurrent_expiration_days",
        "lifecycle_transition_days",
        "lifecycle_abort_multipart_present",
        "lifecycle_abort_multipart_days",
    }
)
_CORS_PARAMS = frozenset({"cors_allowed_method", "cors_allowed_origin"})
_NOTIFICATION_ENTRY_PARAMS = frozenset(
    {
        "notification_rule_id",
        "notification_rule_type",
        "notification_topic_name",
        "notification_event",
        "notification_filter_prefix",
        "notification_filter_suffix",
    }
)
_SSE_PARAMS = frozenset({"sse_algorithm", "sse_kms_key_id"})


def _grouped_rule_op(rule: BucketFilterRule, force_presence_positive: bool) -> str:
    op = (rule.op or "").strip().lower()
    return "has" if force_presence_positive and op == "has_not" else op


_GroupedEntry = TypeVar("_GroupedEntry")
_GroupedEntryMatcher = Callable[[_GroupedEntry, BucketFilterRule, bool], bool]


def _match_grouped_entry_rule_individual(
    rule: BucketFilterRule,
    entries: list[_GroupedEntry],
    matcher: _GroupedEntryMatcher[_GroupedEntry],
) -> bool:
    force_presence_positive = (rule.op or "").strip().lower() == "has_not"
    matched_any = any(matcher(entry, rule, force_presence_positive) for entry in entries)
    if force_presence_positive:
        return not matched_any
    return matched_any if feature_param_quantifier(rule) == "any" else not matched_any


def _match_grouped_entry_rules_all(
    rules: list[BucketFilterRule],
    entries: list[_GroupedEntry],
    matcher: _GroupedEntryMatcher[_GroupedEntry],
) -> bool:
    positive_rules: list[BucketFilterRule] = []
    forbidden_rules: list[BucketFilterRule] = []
    for rule in rules:
        op = (rule.op or "").strip().lower()
        if op == "has_not" or feature_param_quantifier(rule) == "none":
            forbidden_rules.append(rule)
        else:
            positive_rules.append(rule)

    if positive_rules and not any(
        all(matcher(entry, rule, False) for rule in positive_rules)
        for entry in entries
    ):
        return False

    for rule in forbidden_rules:
        force_presence_positive = (rule.op or "").strip().lower() == "has_not"
        if any(matcher(entry, rule, force_presence_positive) for entry in entries):
            return False
    return True


def _extract_lifecycle_rule_id(rule_entry: dict) -> str | None:
    raw = rule_entry.get("ID")
    if raw is None:
        raw = rule_entry.get("Id")
    if raw is None:
        raw = rule_entry.get("id")
    if raw is None:
        return None
    value = str(raw).strip()
    return value or None


def _extract_lifecycle_rule_status(rule_entry: dict) -> str | None:
    raw = rule_entry.get("Status")
    if raw is None:
        raw = rule_entry.get("status")
    if raw is None:
        return None
    value = str(raw).strip()
    return value or None


def _lifecycle_mapping_has_value(rule_entry: dict, section: str, *keys: str) -> bool:
    value = rule_entry.get(section)
    return isinstance(value, dict) and any(value.get(key) is not None for key in keys)


def _lifecycle_delete_marker_expiration(rule_entry: dict) -> bool:
    expiration = rule_entry.get("Expiration")
    return isinstance(expiration, dict) and expiration.get("ExpiredObjectDeleteMarker") is True


def _lifecycle_transition_present(rule_entry: dict, plural: str, singular: str) -> bool:
    transitions = rule_entry.get(plural)
    return (isinstance(transitions, list) and bool(transitions)) or isinstance(
        rule_entry.get(singular),
        dict,
    )


_LifecycleRuleTypePredicate = Callable[[dict], bool]
_LIFECYCLE_RULE_TYPE_PREDICATES: tuple[tuple[str, _LifecycleRuleTypePredicate], ...] = (
    ("expiration", lambda entry: _lifecycle_mapping_has_value(entry, "Expiration", "Days", "Date")),
    ("delete_markers", _lifecycle_delete_marker_expiration),
    (
        "noncurrent_expiration",
        lambda entry: _lifecycle_mapping_has_value(entry, "NoncurrentVersionExpiration", "NoncurrentDays"),
    ),
    (
        "abort_multipart",
        lambda entry: _lifecycle_mapping_has_value(entry, "AbortIncompleteMultipartUpload", "DaysAfterInitiation"),
    ),
    ("transition", lambda entry: _lifecycle_transition_present(entry, "Transitions", "Transition")),
    (
        "noncurrent_transition",
        lambda entry: _lifecycle_transition_present(
            entry,
            "NoncurrentVersionTransitions",
            "NoncurrentVersionTransition",
        ),
    ),
)


def _extract_lifecycle_rule_types(rule_entry: dict) -> list[str]:
    return [
        rule_type
        for rule_type, predicate in _LIFECYCLE_RULE_TYPE_PREDICATES
        if predicate(rule_entry)
    ]


_LifecycleParamMatcher = Callable[[dict, str, object], bool]


def _match_lifecycle_rule_type(entry: dict, op: str, expected: object) -> bool:
    values = _extract_lifecycle_rule_types(entry)
    if op == "has":
        return any(match_text_value(value, "eq", expected) for value in values)
    if op == "has_not":
        return not any(match_text_value(value, "eq", expected) for value in values)
    return False


def _match_lifecycle_abort_presence(entry: dict, op: str, _expected: object) -> bool:
    present = extract_lifecycle_abort_days(entry) is not None
    if op == "has":
        return present
    if op == "has_not":
        return not present
    return False


def _match_lifecycle_transition_days(entry: dict, op: str, expected: object) -> bool:
    return any(
        match_numeric_value(days, op, expected)
        for days in extract_lifecycle_transition_days(entry)
    )


_LIFECYCLE_PARAM_MATCHERS: dict[str, _LifecycleParamMatcher] = {
    "lifecycle_rule_id": lambda entry, op, expected: match_text_value(
        _extract_lifecycle_rule_id(entry), op, expected
    ),
    "lifecycle_rule_status": lambda entry, op, expected: match_text_value(
        _extract_lifecycle_rule_status(entry), op, expected
    ),
    "lifecycle_rule_type": _match_lifecycle_rule_type,
    "lifecycle_expiration_days": lambda entry, op, expected: match_numeric_value(
        extract_lifecycle_expiration_days(entry), op, expected
    ),
    "lifecycle_noncurrent_expiration_days": lambda entry, op, expected: match_numeric_value(
        extract_lifecycle_noncurrent_expiration_days(entry), op, expected
    ),
    "lifecycle_transition_days": _match_lifecycle_transition_days,
    "lifecycle_abort_multipart_present": _match_lifecycle_abort_presence,
    "lifecycle_abort_multipart_days": lambda entry, op, expected: match_numeric_value(
        extract_lifecycle_abort_days(entry), op, expected
    ),
}


def _lifecycle_rule_matches_param(
    lifecycle_rule: dict,
    rule: BucketFilterRule,
    force_presence_positive: bool = False,
) -> bool:
    matcher = _LIFECYCLE_PARAM_MATCHERS.get(rule.param or "")
    if matcher is None:
        return False
    return matcher(
        lifecycle_rule,
        _grouped_rule_op(rule, force_presence_positive),
        rule.value,
    )


def _match_lifecycle_param_rule_individual(rule: BucketFilterRule, lifecycle_rules: list[dict]) -> bool:
    return _match_grouped_entry_rule_individual(rule, lifecycle_rules, _lifecycle_rule_matches_param)


def _match_lifecycle_param_rules_all(rules: list[BucketFilterRule], lifecycle_rules: list[dict]) -> bool:
    return _match_grouped_entry_rules_all(rules, lifecycle_rules, _lifecycle_rule_matches_param)


def _match_text_candidates(values: list[str], op: str, right_raw: object) -> bool:
    if op == "neq":
        return not any(match_text_value(value, "eq", right_raw) for value in values)
    return any(match_text_value(value, op, right_raw) for value in values)


def _match_presence_values(values: list[str], op: str, right_raw: object) -> bool:
    if op == "has":
        return any(match_text_value(value, "eq", right_raw) for value in values)
    if op == "has_not":
        return not any(match_text_value(value, "eq", right_raw) for value in values)
    return False


def _cors_rule_matches_param(
    entry: dict,
    rule: BucketFilterRule,
    force_presence_positive: bool = False,
) -> bool:
    op = _grouped_rule_op(rule, force_presence_positive)
    values = extract_cors_rule_values(entry, rule.param or "")
    if op in {"has", "has_not"}:
        return _match_presence_values(values, op, rule.value)
    return _match_text_candidates(values, op, rule.value)


def _match_cors_param_rule_individual(rule: BucketFilterRule, cors_rules: list[dict]) -> bool:
    return _match_grouped_entry_rule_individual(rule, cors_rules, _cors_rule_matches_param)


def _match_cors_param_rules_all(rules: list[BucketFilterRule], cors_rules: list[dict]) -> bool:
    return _match_grouped_entry_rules_all(rules, cors_rules, _cors_rule_matches_param)


def _sse_rule_matches_param(
    entry: dict,
    rule: BucketFilterRule,
    _force_presence_positive: bool = False,
) -> bool:
    values = extract_sse_rule_values(entry, rule.param or "")
    return _match_text_candidates(values, (rule.op or "").strip().lower(), rule.value)


def _match_sse_param_rule_individual(rule: BucketFilterRule, configuration: object) -> bool:
    return _match_grouped_entry_rule_individual(
        rule,
        encryption_rule_entries(configuration),
        _sse_rule_matches_param,
    )


def _match_sse_param_rules_all(rules: list[BucketFilterRule], configuration: object) -> bool:
    return _match_grouped_entry_rules_all(
        rules,
        encryption_rule_entries(configuration),
        _sse_rule_matches_param,
    )


def _notification_rule_matches_param(
    notification_entry: tuple[str, dict],
    rule: BucketFilterRule,
    force_presence_positive: bool = False,
) -> bool:
    entry_type, entry = notification_entry
    param = rule.param
    op = _grouped_rule_op(rule, force_presence_positive)
    if param == "notification_rule_id":
        return match_text_value(extract_notification_rule_id(entry), op, rule.value)
    if param == "notification_rule_type":
        return _match_presence_values([entry_type], op, rule.value)
    if param == "notification_topic_name":
        if entry_type != "topic":
            return False
        return _match_text_candidates(extract_notification_topic_match_values(entry), op, rule.value)
    if param == "notification_event":
        return _match_presence_values(extract_notification_events(entry), op, rule.value)
    if param == "notification_filter_prefix":
        return _match_presence_values(extract_notification_filter_values(entry, "prefix"), op, rule.value)
    if param == "notification_filter_suffix":
        return _match_presence_values(extract_notification_filter_values(entry, "suffix"), op, rule.value)
    return False


def _match_notification_param_rule_individual(rule: BucketFilterRule, configuration: object) -> bool:
    return _match_grouped_entry_rule_individual(
        rule,
        notification_rule_entries(configuration),
        _notification_rule_matches_param,
    )


def _match_notification_param_rules_all(rules: list[BucketFilterRule], configuration: object) -> bool:
    return _match_grouped_entry_rules_all(
        rules,
        notification_rule_entries(configuration),
        _notification_rule_matches_param,
    )


_INVALID_GROUP_SOURCE = object()


def _normalize_lifecycle_group_source(source_data: object) -> object:
    if not isinstance(source_data, list):
        return _INVALID_GROUP_SOURCE
    return [item for item in source_data if isinstance(item, dict)]


def _normalize_cors_group_source(source_data: object) -> object:
    if not isinstance(source_data, BucketProperties):
        return _INVALID_GROUP_SOURCE
    raw_rules = source_data.cors_rules if isinstance(source_data.cors_rules, list) else []
    return [item for item in raw_rules if isinstance(item, dict)]


def _normalize_notification_group_source(source_data: object) -> object:
    return source_data if isinstance(source_data, dict) else _INVALID_GROUP_SOURCE


def _identity_group_source(source_data: object) -> object:
    return source_data


_GroupedRulesMatcher = Callable[[list[BucketFilterRule], Any], bool]
_GroupedRuleMatcher = Callable[[BucketFilterRule, Any], bool]
_GroupedRuleSpec = tuple[
    str,
    frozenset[str],
    Callable[[object], object],
    _GroupedRulesMatcher,
    _GroupedRuleMatcher,
]
_GROUPED_RULE_SPECS: dict[str, _GroupedRuleSpec] = {
    "lifecycle_rules": (
        "lifecycle",
        _LIFECYCLE_PARAMS,
        _normalize_lifecycle_group_source,
        _match_lifecycle_param_rules_all,
        _match_lifecycle_param_rule_individual,
    ),
    "cors": (
        "props",
        _CORS_PARAMS,
        _normalize_cors_group_source,
        _match_cors_param_rules_all,
        _match_cors_param_rule_individual,
    ),
    "notifications": (
        "notifications",
        _NOTIFICATION_ENTRY_PARAMS,
        _normalize_notification_group_source,
        _match_notification_param_rules_all,
        _match_notification_param_rule_individual,
    ),
    "server_side_encryption": (
        "encryption",
        _SSE_PARAMS,
        _identity_group_source,
        _match_sse_param_rules_all,
        _match_sse_param_rule_individual,
    ),
}


def grouped_feature_names() -> tuple[str, ...]:
    return tuple(_GROUPED_RULE_SPECS)


def grouped_feature_source(feature: str) -> str | None:
    spec = _GROUPED_RULE_SPECS.get(feature)
    return spec[0] if spec else None


def grouped_feature_param_source(feature: str, param: str) -> str | None:
    spec = _GROUPED_RULE_SPECS.get(feature)
    if spec is None or param not in spec[1]:
        return None
    return spec[0]


def match_grouped_feature_param_rules(
    feature: str,
    rules: list[BucketFilterRule],
    match_mode: str,
    source_data: object,
) -> bool:
    spec = _GROUPED_RULE_SPECS.get(feature)
    if spec is None or not rules:
        return False
    _, _, normalize_source, match_all, match_one = spec
    normalized_source = normalize_source(source_data)
    if normalized_source is _INVALID_GROUP_SOURCE:
        return False
    if match_mode == "all":
        return match_all(rules, normalized_source)
    return any(match_one(rule, normalized_source) for rule in rules)
