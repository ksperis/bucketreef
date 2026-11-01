# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Callable, TypeVar, cast

from app.models.bucket import (
    BucketLoggingConfiguration,
    BucketProperties,
    BucketWebsiteConfiguration,
)
from app.models.bucket_filter import BucketFilterRule
from app.services.bucket_feature_param_predicates import (
    feature_param_quantifier,
    match_bool_value,
    match_numeric_value,
    match_text_value,
)
from app.services.bucket_feature_param_values import (
    extract_notification_eventbridge_present,
    extract_policy_statement_summary,
)
from app.services.bucket_listing_shared import coerce_filter_number
from app.utils.normalize import normalize_optional_string


def _apply_scalar_quantifier(rule: BucketFilterRule, result: bool) -> bool:
    return result if feature_param_quantifier(rule) == "any" else not result


_PropertyValueGetter = Callable[[BucketProperties], object]
_PROPERTY_SCALAR_SPECS: dict[str, tuple[str, _PropertyValueGetter]] = {
    "object_lock_mode": ("text", lambda props: props.object_lock.mode if props.object_lock else None),
    "object_lock_retention_days": ("number", lambda props: props.object_lock.days if props.object_lock else None),
    "object_lock_retention_years": ("number", lambda props: props.object_lock.years if props.object_lock else None),
    "bpa_block_public_acls": (
        "bool",
        lambda props: props.public_access_block.block_public_acls if props.public_access_block else None,
    ),
    "bpa_ignore_public_acls": (
        "bool",
        lambda props: props.public_access_block.ignore_public_acls if props.public_access_block else None,
    ),
    "bpa_block_public_policy": (
        "bool",
        lambda props: props.public_access_block.block_public_policy if props.public_access_block else None,
    ),
    "bpa_restrict_public_buckets": (
        "bool",
        lambda props: props.public_access_block.restrict_public_buckets if props.public_access_block else None,
    ),
}


def _match_scalar_value(kind: str, value: object, op: str, expected: object) -> bool:
    if kind == "text":
        return match_text_value(cast(str | None, value), op, expected)
    if kind == "number":
        return match_numeric_value(coerce_filter_number(value), op, expected)
    if kind == "bool":
        return match_bool_value(cast(bool | None, value), op, expected)
    return False


_ScalarSource = TypeVar("_ScalarSource")


def _match_scalar_spec(
    rule: BucketFilterRule,
    source_data: _ScalarSource,
    op: str,
    specs: dict[str, tuple[str, Callable[[_ScalarSource], object]]],
) -> bool:
    spec = specs.get(rule.param or "")
    if spec is None:
        return False
    kind, getter = spec
    return _apply_scalar_quantifier(
        rule,
        _match_scalar_value(kind, getter(source_data), op, rule.value),
    )


def _match_properties_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if not isinstance(source_data, BucketProperties):
        return False
    return _match_scalar_spec(rule, source_data, op, _PROPERTY_SCALAR_SPECS)


_LoggingValueGetter = Callable[[BucketLoggingConfiguration], object]
_LOGGING_SCALAR_SPECS: dict[str, tuple[str, _LoggingValueGetter]] = {
    "logging_enabled": (
        "bool",
        lambda logging: bool(logging.enabled and normalize_optional_string(logging.target_bucket)),
    ),
    "logging_target_bucket": ("text", lambda logging: normalize_optional_string(logging.target_bucket)),
    "logging_target_prefix": ("text", lambda logging: normalize_optional_string(logging.target_prefix)),
}


def _match_logging_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if not isinstance(source_data, BucketLoggingConfiguration):
        return False
    return _match_scalar_spec(rule, source_data, op, _LOGGING_SCALAR_SPECS)


def _website_redirect_host(configuration: BucketWebsiteConfiguration) -> str | None:
    redirect = configuration.redirect_all_requests_to
    return normalize_optional_string(redirect.host_name if redirect else None)


_WebsiteValueGetter = Callable[[BucketWebsiteConfiguration], object]
_WEBSITE_SCALAR_SPECS: dict[str, tuple[str, _WebsiteValueGetter]] = {
    "website_index_present": ("bool", lambda website: bool(normalize_optional_string(website.index_document))),
    "website_index_document": ("text", lambda website: normalize_optional_string(website.index_document)),
    "website_error_document": ("text", lambda website: normalize_optional_string(website.error_document)),
    "website_redirect_host_present": ("bool", lambda website: bool(_website_redirect_host(website))),
    "website_redirect_host": ("text", _website_redirect_host),
    "website_routing_rule_count": ("number", lambda website: len(website.routing_rules)),
}


def _match_website_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if not isinstance(source_data, BucketWebsiteConfiguration):
        return False
    return _match_scalar_spec(rule, source_data, op, _WEBSITE_SCALAR_SPECS)


def _match_policy_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    policy = source_data if isinstance(source_data, dict) else None
    statement_count, has_conditions = extract_policy_statement_summary(policy)
    if rule.param == "policy_statement_count":
        result = match_numeric_value(float(statement_count), op, rule.value)
    elif rule.param == "policy_has_conditions":
        result = match_bool_value(has_conditions, op, rule.value)
    else:
        return False
    return _apply_scalar_quantifier(rule, result)


def _match_notification_scalar_param_rule(
    rule: BucketFilterRule,
    source_data: object,
    op: str,
) -> bool:
    if rule.param != "notification_eventbridge_present":
        return False
    result = match_bool_value(extract_notification_eventbridge_present(source_data), op, rule.value)
    return _apply_scalar_quantifier(rule, result)


_SCALAR_SOURCE_MATCHERS: dict[str, Callable[[BucketFilterRule, object, str], bool]] = {
    "props": _match_properties_param_rule,
    "logging": _match_logging_param_rule,
    "website": _match_website_param_rule,
    "policy": _match_policy_param_rule,
    "notifications": _match_notification_scalar_param_rule,
}


def match_scalar_feature_param_rule(
    rule: BucketFilterRule,
    source: str,
    source_data: object,
) -> bool:
    op = (rule.op or "").strip().lower()
    if not rule.param or not op:
        return False
    matcher = _SCALAR_SOURCE_MATCHERS.get(source)
    return matcher(rule, source_data, op) if matcher else False
