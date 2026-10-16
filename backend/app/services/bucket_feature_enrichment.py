# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Protocol

from app.models.bucket import (
    Bucket,
    BucketFeatureStatus,
    BucketLoggingConfiguration,
    BucketNotificationConfiguration,
    BucketTag,
    BucketWebsiteConfiguration,
)
from app.services.bucket_notification_state import (
    execution_context_sns_feature_enabled,
    is_bucket_notification_configuration_configured,
)
from app.services.bucket_property_feature_enrichment import (
    BUCKET_PROPERTY_FEATURES,
    BucketPropertyFeatureReader,
    active_feature_status,
    enrich_cors,
    enrich_lifecycle,
    enrich_object_lock,
    enrich_public_access_block,
    enrich_versioning,
    inactive_feature_status,
    load_bucket_properties_context,
    unavailable_feature_status,
)
from app.services.s3_execution_context import S3ExecutionTarget


ALLOWED_BUCKET_FEATURES = {
    "tags",
    "versioning",
    "object_lock",
    "block_public_access",
    "lifecycle_rules",
    "static_website",
    "bucket_policy",
    "cors",
    "access_logging",
    "notifications",
}


class BucketFeatureReader(BucketPropertyFeatureReader, Protocol):
    def get_bucket_tags(self, name: str, execution_context: S3ExecutionTarget) -> list[BucketTag]: ...

    def get_bucket_website(self, name: str, execution_context: S3ExecutionTarget) -> BucketWebsiteConfiguration: ...

    def get_policy(self, name: str, execution_context: S3ExecutionTarget) -> dict | None: ...

    def get_bucket_logging(self, name: str, execution_context: S3ExecutionTarget) -> BucketLoggingConfiguration: ...

    def get_bucket_notifications(self, name: str, execution_context: S3ExecutionTarget) -> BucketNotificationConfiguration: ...


def _load_bucket_tags(
    reader: BucketFeatureReader,
    bucket_name: str,
    execution_context: S3ExecutionTarget,
    *,
    requested: bool,
) -> list[BucketTag] | None:
    if not requested:
        return None
    try:
        return reader.get_bucket_tags(bucket_name, execution_context)
    except RuntimeError:
        return []


def _enrich_property_features(
    reader: BucketFeatureReader,
    bucket_name: str,
    execution_context: S3ExecutionTarget,
    requested: set[str],
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    property_features = requested & BUCKET_PROPERTY_FEATURES
    if not property_features:
        return

    properties_context = load_bucket_properties_context(
        reader,
        bucket_name,
        execution_context,
        uses_bundle=len(property_features) > 1,
    )
    if "versioning" in property_features:
        enrich_versioning(properties_context, feature_map)
    if "object_lock" in property_features:
        enrich_object_lock(properties_context, feature_map)
    if "block_public_access" in property_features:
        enrich_public_access_block(properties_context, feature_map)
    if "lifecycle_rules" in property_features:
        enrich_lifecycle(properties_context, feature_map)
    if "cors" in property_features:
        enrich_cors(properties_context, feature_map)


def _enrich_static_website(
    reader: BucketFeatureReader,
    bucket_name: str,
    execution_context: S3ExecutionTarget,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    try:
        website = reader.get_bucket_website(bucket_name, execution_context)
        routing_rules = website.routing_rules or []
        configured = bool(
            (website.redirect_all_requests_to and (website.redirect_all_requests_to.host_name or "").strip())
            or (website.index_document or "").strip()
            or (isinstance(routing_rules, list) and len(routing_rules) > 0)
        )
        feature_map["static_website"] = (
            active_feature_status("Enabled") if configured else inactive_feature_status("Disabled")
        )
    except RuntimeError:
        feature_map["static_website"] = unavailable_feature_status()


def _enrich_bucket_policy(
    reader: BucketFeatureReader,
    bucket_name: str,
    execution_context: S3ExecutionTarget,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    try:
        policy = reader.get_policy(bucket_name, execution_context)
        configured = bool(policy and isinstance(policy, dict) and len(policy) > 0)
        feature_map["bucket_policy"] = (
            active_feature_status("Configured") if configured else inactive_feature_status("Not set")
        )
    except RuntimeError:
        feature_map["bucket_policy"] = unavailable_feature_status()


def _enrich_access_logging(
    reader: BucketFeatureReader,
    bucket_name: str,
    execution_context: S3ExecutionTarget,
    feature_map: dict[str, BucketFeatureStatus],
) -> None:
    try:
        logging_config = reader.get_bucket_logging(bucket_name, execution_context)
        enabled = bool(logging_config.enabled and (logging_config.target_bucket or "").strip())
        feature_map["access_logging"] = (
            active_feature_status("Enabled") if enabled else inactive_feature_status("Disabled")
        )
    except RuntimeError:
        feature_map["access_logging"] = unavailable_feature_status()


def _enrich_notifications(
    reader: BucketFeatureReader,
    bucket_name: str,
    execution_context: S3ExecutionTarget,
    feature_map: dict[str, BucketFeatureStatus],
    *,
    sns_feature_enabled: bool,
) -> None:
    if not sns_feature_enabled:
        feature_map["notifications"] = unavailable_feature_status()
        return
    try:
        notifications = reader.get_bucket_notifications(bucket_name, execution_context)
        configured = is_bucket_notification_configuration_configured(notifications.configuration)
        feature_map["notifications"] = (
            active_feature_status("Configured") if configured else inactive_feature_status("Not set")
        )
    except RuntimeError:
        feature_map["notifications"] = unavailable_feature_status()


def _enrich_independent_features(
    reader: BucketFeatureReader,
    bucket_name: str,
    execution_context: S3ExecutionTarget,
    requested: set[str],
    feature_map: dict[str, BucketFeatureStatus],
    *,
    sns_feature_enabled: bool,
) -> None:
    if "static_website" in requested:
        _enrich_static_website(reader, bucket_name, execution_context, feature_map)
    if "bucket_policy" in requested:
        _enrich_bucket_policy(reader, bucket_name, execution_context, feature_map)
    if "access_logging" in requested:
        _enrich_access_logging(reader, bucket_name, execution_context, feature_map)
    if "notifications" in requested:
        _enrich_notifications(
            reader,
            bucket_name,
            execution_context,
            feature_map,
            sns_feature_enabled=sns_feature_enabled,
        )


def enrich_bucket_features(
    reader: BucketFeatureReader,
    buckets: list[Bucket],
    execution_context: S3ExecutionTarget,
    include: set[str],
) -> list[Bucket]:
    requested = {key for key in include if key in ALLOWED_BUCKET_FEATURES}
    if not requested:
        return buckets

    wants_tags = "tags" in requested
    sns_feature_enabled = execution_context_sns_feature_enabled(execution_context)

    result: list[Bucket] = []
    for bucket in buckets:
        feature_map: dict[str, BucketFeatureStatus] = {}
        tags = _load_bucket_tags(
            reader,
            bucket.name,
            execution_context,
            requested=wants_tags,
        )
        _enrich_property_features(
            reader,
            bucket.name,
            execution_context,
            requested,
            feature_map,
        )
        _enrich_independent_features(
            reader,
            bucket.name,
            execution_context,
            requested,
            feature_map,
            sns_feature_enabled=sns_feature_enabled,
        )

        base = bucket.model_dump(exclude={"tags", "features"})
        result.append(Bucket(**base, tags=tags, features=feature_map or None))

    return result
