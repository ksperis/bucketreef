# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.bucket_filter import BucketFilterQuery
from app.models.storage_ops import StorageOpsBucketSummary
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


BUCKET_REF_SEPARATOR = "::"


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

    def base_match(bucket: StorageOpsBucketSummary) -> bool:
        results = [
            *(match_storage_ops_field_rule(bucket, rule) for rule in field_rules),
            *(match_bucket_feature_rule(bucket, rule) for rule in feature_state_rules),
        ]
        if not results:
            return not feature_param_rules or match_mode == "all"
        return all(results) if match_mode == "all" else any(results)

    if not feature_param_rules:
        return [bucket for bucket in buckets if base_match(bucket)]

    if match_mode == "all":
        pre_matched: list[StorageOpsBucketSummary] = []
        param_candidates = [bucket for bucket in buckets if base_match(bucket)]
    else:
        pre_matched = []
        param_candidates = []
        for bucket in buckets:
            if base_match(bucket):
                pre_matched.append(bucket)
            else:
                param_candidates.append(bucket)
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
) -> tuple[list, list, list, str]:
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
