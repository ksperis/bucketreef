# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.storage_endpoint_features import resolve_feature_flags


def account_sns_feature_enabled(account: S3ExecutionTarget) -> bool:
    endpoint = account.storage_endpoint
    if endpoint is None:
        return True
    if endpoint.features_config is None and endpoint.provider is None:
        return True
    try:
        return resolve_feature_flags(endpoint).sns_enabled
    except Exception:  # noqa: BLE001
        return False


def _normalize_notification_value(value: Any) -> Any | None:
    if value is None:
        return None
    if isinstance(value, dict):
        normalized: dict[str, Any] = {}
        for key, entry in value.items():
            cleaned = _normalize_notification_value(entry)
            if cleaned is not None:
                normalized[str(key)] = cleaned
        return normalized or None
    if isinstance(value, list):
        normalized_items = [
            cleaned
            for item in value
            if (cleaned := _normalize_notification_value(item)) is not None
        ]
        return normalized_items or None
    return value


def normalize_bucket_notification_configuration(configuration: Any) -> dict[str, Any]:
    if not isinstance(configuration, dict):
        return {}
    normalized = _normalize_notification_value(configuration)
    return normalized if isinstance(normalized, dict) else {}


def is_bucket_notification_configuration_configured(configuration: Any) -> bool:
    return bool(normalize_bucket_notification_configuration(configuration))
