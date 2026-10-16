# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from app.models.bucket_listing import BucketListingSummary
from app.services.s3_execution_context import S3ExecutionTarget
from app.models.bucket_config_backup import (
    BucketConfigBackupBucket,
    BucketConfigBackupFeature,
    BucketConfigBackupResponse,
    BucketConfigBackupSource,
)
from app.services.bucket_configuration_service import BucketConfigurationService
from app.services.buckets_service import BucketsService
from app.utils.jsonable import model_to_jsonable

QuotaSnapshotLoader = Callable[[str], dict[str, int | None]]


class BucketConfigBackupService:
    def __init__(
        self,
        configuration_service: BucketConfigurationService | None = None,
        bucket_stats_service: BucketsService | None = None,
    ) -> None:
        self._configuration = configuration_service or BucketConfigurationService()
        self._bucket_stats = bucket_stats_service or BucketsService()

    def build_backup(
        self,
        *,
        execution_context: S3ExecutionTarget,
        bucket_names: list[str],
        features: list[BucketConfigBackupFeature],
        source: BucketConfigBackupSource,
        quota_loader: QuotaSnapshotLoader | None = None,
    ) -> BucketConfigBackupResponse:
        selected_features = list(dict.fromkeys(features))
        return BucketConfigBackupResponse(
            generated_at=datetime.now(timezone.utc),
            source=source,
            features=selected_features,
            buckets=[
                self._build_bucket_backup(
                    execution_context=execution_context,
                    bucket_name=bucket_name,
                    features=selected_features,
                    quota_loader=quota_loader,
                )
                for bucket_name in bucket_names
            ],
        )

    def _build_bucket_backup(
        self,
        *,
        execution_context: S3ExecutionTarget,
        bucket_name: str,
        features: list[BucketConfigBackupFeature],
        quota_loader: QuotaSnapshotLoader | None,
    ) -> BucketConfigBackupBucket:
        configuration: dict[str, Any] = {}
        errors: dict[str, str] = {}

        for feature in features:
            try:
                configuration[feature] = self._load_feature(
                    execution_context,
                    bucket_name,
                    feature,
                    quota_loader,
                )
            except Exception as exc:  # noqa: BLE001 - backup files should carry per-feature failures.
                errors[feature] = str(exc)

        return BucketConfigBackupBucket(name=bucket_name, configuration=configuration, errors=errors)

    def _load_feature(
        self,
        execution_context: S3ExecutionTarget,
        bucket_name: str,
        feature: BucketConfigBackupFeature,
        quota_loader: QuotaSnapshotLoader | None,
    ) -> Any:
        if feature == "quota":
            return self._load_quota(execution_context, bucket_name, quota_loader)
        if feature == "versioning":
            status_value = self._configuration.get_bucket_versioning_status(bucket_name, execution_context)
            return {"status": status_value, "enabled": status_value == "Enabled"}
        if feature == "object_lock":
            return model_to_jsonable(self._configuration.get_object_lock(bucket_name, execution_context))
        if feature == "public_access_block":
            return model_to_jsonable(self._configuration.get_public_access_block(bucket_name, execution_context))
        if feature == "lifecycle":
            lifecycle = self._configuration.get_lifecycle(bucket_name, execution_context)
            return {"rules": lifecycle.rules or []}
        if feature == "cors":
            return {"rules": self._configuration.get_bucket_cors(bucket_name, execution_context) or []}
        if feature == "policy":
            return {"policy": self._configuration.get_policy(bucket_name, execution_context)}
        if feature == "access_logging":
            return model_to_jsonable(self._configuration.get_bucket_logging(bucket_name, execution_context))
        if feature == "tags":
            tags = self._configuration.get_bucket_tags(bucket_name, execution_context)
            return {"tags": [model_to_jsonable(tag) for tag in tags]}
        raise ValueError(f"Unsupported backup feature: {feature}")

    def _load_quota(
        self,
        execution_context: S3ExecutionTarget,
        bucket_name: str,
        quota_loader: QuotaSnapshotLoader | None,
    ) -> dict[str, int | None]:
        if quota_loader is not None:
            snapshot = quota_loader(bucket_name)
            return {
                "max_size_bytes": _normalize_quota_limit(snapshot.get("max_size_bytes")),
                "max_objects": _normalize_quota_limit(snapshot.get("max_objects")),
            }

        stats = self._bucket_stats.get_bucket_stats(bucket_name, execution_context, with_stats=True)
        return {
            "max_size_bytes": _normalize_quota_limit(stats.quota_max_size_bytes),
            "max_objects": _normalize_quota_limit(stats.quota_max_objects),
        }


def _normalize_quota_limit(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def quota_from_bucket_summary(bucket: BucketListingSummary | None) -> dict[str, int | None]:
    if bucket is None:
        return {"max_size_bytes": None, "max_objects": None}
    return {
        "max_size_bytes": _normalize_quota_limit(bucket.quota_max_size_bytes),
        "max_objects": _normalize_quota_limit(bucket.quota_max_objects),
    }
