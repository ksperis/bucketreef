# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.bucket_filter import BucketFilterQuery, BucketFilterRule
from app.models.storage_ops import StorageOpsBucketSummary
from app.services.bucket_listing_owner_metadata import OWNER_DETAIL_FIELDS
from app.services.bucket_listing_shared import listing_sort_key
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.bucket_feature_param_matching import (
    match_bucket_feature_param_rules,
)
from app.services.bucket_feature_param_snapshot_loader import (
    load_bucket_feature_param_snapshots,
)
from app.services.bucket_listing_rule_matching import (
    match_bucket_feature_rule,
    match_bucket_field_rule,
)
from app.utils.normalize import normalize_text


BUCKET_REF_SEPARATOR = "::"


def match_storage_ops_simple_search(
    bucket: StorageOpsBucketSummary,
    normalized_search: str,
) -> bool:
    candidates = [
        bucket.bucket_name or bucket.name,
        bucket.owner,
        bucket.owner_name,
        bucket.tenant,
        bucket.context_id,
        bucket.context_name,
        bucket.context_kind,
        bucket.endpoint_name,
    ]
    for candidate in candidates:
        if candidate and normalized_search in normalize_text(str(candidate)):
            return True
    for tag in bucket.tags or []:
        if (
            normalized_search in normalize_text(tag.key)
            or normalized_search in normalize_text(tag.value)
        ):
            return True
    return False


def _is_cheap_storage_ops_field_rule(rule: BucketFilterRule) -> bool:
    return bool(
        rule.field
        and rule.field != "tag"
        and rule.field not in OWNER_DETAIL_FIELDS
    )


def _has_deferred_storage_ops_rules(rules: list[BucketFilterRule]) -> bool:
    return any(
        rule.feature
        or rule.field == "tag"
        or rule.field in OWNER_DETAIL_FIELDS
        for rule in rules
    )


def build_storage_ops_cheap_field_prefilter(
    parsed_filter: BucketFilterQuery | None,
) -> tuple[BucketFilterQuery | None, bool]:
    if not parsed_filter or not parsed_filter.rules:
        return None, False

    rules = parsed_filter.rules
    cheap_field_rules = [
        rule
        for rule in rules
        if _is_cheap_storage_ops_field_rule(rule)
    ]
    if not cheap_field_rules:
        return None, False

    has_deferred_rules = _has_deferred_storage_ops_rules(rules)
    if parsed_filter.match == "any" and has_deferred_rules:
        return None, False
    cheap_filter = parsed_filter.model_copy(update={"rules": cheap_field_rules})
    if parsed_filter.match == "any":
        return cheap_filter, True
    return cheap_filter, (
        not has_deferred_rules
        and len(cheap_field_rules) == len(rules)
    )


def sort_storage_ops_buckets(
    buckets: list[StorageOpsBucketSummary],
    *,
    sort_by: str,
    sort_dir: str,
) -> list[StorageOpsBucketSummary]:
    if not buckets:
        return []
    field = (
        sort_by
        if sort_by in {"name", "tenant", "owner", "used_bytes", "object_count"}
        else "name"
    )
    reverse = sort_dir == "desc"

    def value(bucket: StorageOpsBucketSummary):
        if field == "name":
            return bucket.bucket_name or bucket.name
        return getattr(bucket, field, None)

    return sorted(
        buckets,
        key=lambda bucket: listing_sort_key(
            value(bucket),
            bucket.bucket_name or bucket.name,
        ),
        reverse=reverse,
    )


def encode_storage_ops_bucket_ref(context_id: str, bucket_name: str) -> str:
    return f"{context_id}{BUCKET_REF_SEPARATOR}{bucket_name}"


def match_storage_ops_field_rule(
    bucket: StorageOpsBucketSummary,
    rule,
) -> bool:
    if rule.field != "name":
        return match_bucket_field_rule(bucket, rule)
    op = rule.op or ""
    if op in {"is_null", "not_null"}:
        return match_bucket_field_rule(bucket, rule)
    encoded_name = encode_storage_ops_bucket_ref(
        bucket.context_id,
        bucket.bucket_name or bucket.name,
    )
    encoded_bucket = bucket.model_copy(update={"name": encoded_name})
    actual_match = match_bucket_field_rule(bucket, rule)
    encoded_match = match_bucket_field_rule(encoded_bucket, rule)
    if op in {"neq", "not_in"}:
        return actual_match and encoded_match
    return actual_match or encoded_match


def _matches_storage_ops_base_rules(
    bucket: StorageOpsBucketSummary,
    field_rules: list[BucketFilterRule],
    feature_state_rules: list[BucketFilterRule],
    *,
    match_mode: str,
    has_feature_param_rules: bool,
) -> bool:
    results = [
        *(match_storage_ops_field_rule(bucket, rule) for rule in field_rules),
        *(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules),
    ]
    if not results:
        return not has_feature_param_rules or match_mode == "all"
    return all(results) if match_mode == "all" else any(results)


def _partition_storage_ops_param_candidates(
    buckets: list[StorageOpsBucketSummary],
    field_rules: list[BucketFilterRule],
    feature_state_rules: list[BucketFilterRule],
    *,
    match_mode: str,
) -> tuple[list[StorageOpsBucketSummary], list[StorageOpsBucketSummary]]:
    if match_mode == "all":
        return [], [
            bucket
            for bucket in buckets
            if _matches_storage_ops_base_rules(
                bucket,
                field_rules,
                feature_state_rules,
                match_mode=match_mode,
                has_feature_param_rules=True,
            )
        ]

    pre_matched: list[StorageOpsBucketSummary] = []
    param_candidates: list[StorageOpsBucketSummary] = []
    for bucket in buckets:
        target = (
            pre_matched
            if _matches_storage_ops_base_rules(
                bucket,
                field_rules,
                feature_state_rules,
                match_mode=match_mode,
                has_feature_param_rules=True,
            )
            else param_candidates
        )
        target.append(bucket)
    return pre_matched, param_candidates


def apply_storage_ops_advanced_filter(
    buckets: list[StorageOpsBucketSummary],
    parsed_filter: BucketFilterQuery | None,
    *,
    service: BucketConfigurationService,
    context,
) -> list[StorageOpsBucketSummary]:
    if not parsed_filter or not parsed_filter.rules or not buckets:
        return buckets
    field_rules, feature_state_rules, feature_param_rules, match_mode = (
        _split_rules(parsed_filter)
    )

    if not feature_param_rules:
        return [
            bucket
            for bucket in buckets
            if _matches_storage_ops_base_rules(
                bucket,
                field_rules,
                feature_state_rules,
                match_mode=match_mode,
                has_feature_param_rules=False,
            )
        ]

    pre_matched, param_candidates = _partition_storage_ops_param_candidates(
        buckets,
        field_rules,
        feature_state_rules,
        match_mode=match_mode,
    )
    if not param_candidates:
        return pre_matched

    snapshots_by_key, _available_keys = load_bucket_feature_param_snapshots(
        param_candidates,
        feature_param_rules,
        service,
        context,
    )
    return [
        *pre_matched,
        *(
            bucket
            for bucket in param_candidates
            if match_bucket_feature_param_rules(
                feature_param_rules,
                match_mode,
                snapshots_by_key.get(f"{bucket.tenant or ''}:{bucket.name}", {}),
            )
        ),
    ]


def _split_rules(
    parsed_filter: BucketFilterQuery | None,
) -> tuple[
    list[BucketFilterRule],
    list[BucketFilterRule],
    list[BucketFilterRule],
    str,
]:
    if not parsed_filter or not parsed_filter.rules:
        return [], [], [], "all"
    field_rules = [rule for rule in parsed_filter.rules if rule.field]
    feature_state_rules = [
        rule
        for rule in parsed_filter.rules
        if rule.feature and rule.state is not None
    ]
    feature_param_rules = [
        rule
        for rule in parsed_filter.rules
        if rule.feature and rule.param is not None
    ]
    return field_rules, feature_state_rules, feature_param_rules, parsed_filter.match
