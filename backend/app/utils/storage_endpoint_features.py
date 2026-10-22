# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import yaml

from app.db import StorageEndpoint, StorageProvider
from app.utils.normalize import normalize_storage_provider


FEATURE_KEYS: tuple[str, ...] = (
    "admin",
    "account",
    "sts",
    "usage",
    "metrics",
    "static_website",
    "iam",
    "sns",
    "sse",
    "replication",
    "healthcheck",
)

AWS_DEFAULT_REGION = "us-east-1"
AWS_IAM_ENDPOINT = "https://iam.amazonaws.com"
AWS_GOV_IAM_ENDPOINT = "https://iam.us-gov.amazonaws.com"
AWS_CN_IAM_ENDPOINT = "https://iam.cn-north-1.amazonaws.com.cn"
_ENDPOINT_FEATURE_KEYS = frozenset({"admin", "iam", "sts"})
_CEPH_ONLY_FEATURE_KEYS = (
    "admin",
    "account",
    "usage",
    "metrics",
    "sns",
    "replication",
)


def _normalize_region(value: Optional[object]) -> str:
    if value is None:
        return AWS_DEFAULT_REGION
    normalized = str(value).strip().lower()
    return normalized or AWS_DEFAULT_REGION


def _aws_dns_suffix_for_region(region: Optional[object]) -> str:
    normalized = _normalize_region(region)
    if normalized.startswith("cn-"):
        return "amazonaws.com.cn"
    return "amazonaws.com"


def aws_s3_endpoint_for_region(region: Optional[object] = None) -> str:
    normalized = _normalize_region(region)
    return f"https://s3.{normalized}.{_aws_dns_suffix_for_region(normalized)}"


def aws_sts_endpoint_for_region(region: Optional[object] = None) -> str:
    normalized = _normalize_region(region)
    return f"https://sts.{normalized}.{_aws_dns_suffix_for_region(normalized)}"


def aws_iam_endpoint_for_region(region: Optional[object] = None) -> str:
    normalized = _normalize_region(region)
    if normalized.startswith("cn-"):
        return AWS_CN_IAM_ENDPOINT
    if normalized.startswith("us-gov-"):
        return AWS_GOV_IAM_ENDPOINT
    return AWS_IAM_ENDPOINT


def aws_iam_signing_region_for_region(region: Optional[object] = None) -> str:
    normalized = _normalize_region(region)
    if normalized.startswith("cn-") or normalized.startswith("us-gov-"):
        return normalized
    return AWS_DEFAULT_REGION


def aws_iam_client_options_for_region(region: Optional[object] = None) -> tuple[str, str]:
    return aws_iam_endpoint_for_region(region), aws_iam_signing_region_for_region(region)


AWS_S3_ENDPOINT = aws_s3_endpoint_for_region(AWS_DEFAULT_REGION)
AWS_STS_ENDPOINT = aws_sts_endpoint_for_region(AWS_DEFAULT_REGION)

DEFAULT_FEATURES: dict[StorageProvider, dict[str, dict[str, Any]]] = {
    StorageProvider.CEPH: {
        "admin": {"enabled": False, "endpoint": None},
        "account": {"enabled": False, "endpoint": None},
        "sts": {"enabled": False, "endpoint": None},
        "usage": {"enabled": False, "endpoint": None},
        "metrics": {"enabled": False, "endpoint": None},
        "static_website": {"enabled": False, "endpoint": None},
        "iam": {"enabled": False, "endpoint": None},
        "sns": {"enabled": False, "endpoint": None},
        "sse": {"enabled": False, "endpoint": None},
        "replication": {"enabled": False, "endpoint": None},
        "healthcheck": {"enabled": True, "mode": "http", "url": None},
    },
    StorageProvider.AWS: {
        "admin": {"enabled": False, "endpoint": None},
        "account": {"enabled": False, "endpoint": None},
        "sts": {"enabled": True, "endpoint": AWS_STS_ENDPOINT},
        "usage": {"enabled": False, "endpoint": None},
        "metrics": {"enabled": False, "endpoint": None},
        "static_website": {"enabled": True, "endpoint": None},
        "iam": {"enabled": True, "endpoint": AWS_IAM_ENDPOINT},
        "sns": {"enabled": False, "endpoint": None},
        "sse": {"enabled": True, "endpoint": None},
        "replication": {"enabled": False, "endpoint": None},
        "healthcheck": {"enabled": True, "mode": "http", "url": None},
    },
    StorageProvider.OTHER: {
        "admin": {"enabled": False, "endpoint": None},
        "account": {"enabled": False, "endpoint": None},
        "sts": {"enabled": False, "endpoint": None},
        "usage": {"enabled": False, "endpoint": None},
        "metrics": {"enabled": False, "endpoint": None},
        "static_website": {"enabled": False, "endpoint": None},
        "iam": {"enabled": False, "endpoint": None},
        "sns": {"enabled": False, "endpoint": None},
        "sse": {"enabled": False, "endpoint": None},
        "replication": {"enabled": False, "endpoint": None},
        "healthcheck": {"enabled": True, "mode": "http", "url": None},
    },
}


@dataclass(frozen=True)
class EndpointFeatureFlags:
    admin_enabled: bool
    admin_endpoint: Optional[str]
    account_enabled: bool
    sts_enabled: bool
    sts_endpoint: Optional[str]
    usage_enabled: bool
    metrics_enabled: bool
    static_website_enabled: bool
    iam_enabled: bool
    iam_endpoint: Optional[str]
    sns_enabled: bool
    sse_enabled: bool
    replication_enabled: bool
    healthcheck_enabled: bool
    healthcheck_mode: str
    healthcheck_url: Optional[str]


def _normalize_url(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = value.strip().rstrip("/")
    return normalized or None


def parse_features_config(raw: Optional[str]) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    try:
        data = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError("Invalid endpoint features YAML.") from exc
    if not isinstance(data, dict):
        raise ValueError("Endpoint features YAML must be a mapping.")
    if set(data) != {"features"}:
        raise ValueError(
            "Endpoint features YAML must contain only the top-level 'features' mapping."
        )
    features = data["features"]
    if not isinstance(features, dict):
        raise ValueError("Endpoint features must be a mapping.")
    return features


def _default_features(
    provider: StorageProvider,
    region: Optional[object],
) -> dict[str, dict[str, Any]]:
    base = DEFAULT_FEATURES.get(provider, DEFAULT_FEATURES[StorageProvider.CEPH])
    features = {key: dict(value) for key, value in base.items()}
    if provider == StorageProvider.AWS:
        aws_region = _normalize_region(region)
        features["sts"]["endpoint"] = aws_sts_endpoint_for_region(aws_region)
        features["iam"]["endpoint"] = aws_iam_endpoint_for_region(aws_region)
    return features


def _validate_feature_names(raw_features: dict[str, Any]) -> None:
    unknown_features = set(raw_features).difference(FEATURE_KEYS)
    if not unknown_features:
        return
    labels = ", ".join(sorted(str(key) for key in unknown_features))
    raise ValueError(f"Unknown endpoint feature(s): {labels}.")


def _allowed_feature_fields(key: str) -> set[str]:
    allowed_fields = {"enabled"}
    if key in _ENDPOINT_FEATURE_KEYS:
        allowed_fields.add("endpoint")
    if key == "healthcheck":
        allowed_fields.update({"healthcheck_url", "mode"})
    return allowed_fields


def _validate_feature_fields(key: str, value: dict[str, Any]) -> None:
    unknown_fields = set(value).difference(_allowed_feature_fields(key))
    if not unknown_fields:
        return
    labels = ", ".join(sorted(str(field) for field in unknown_fields))
    raise ValueError(f"Unknown field(s) for feature '{key}': {labels}.")


def _enabled_override(key: str, value: dict[str, Any]) -> dict[str, Any]:
    if "enabled" not in value:
        return {}
    enabled = value.get("enabled")
    if not isinstance(enabled, bool):
        raise ValueError(f"Feature '{key}.enabled' must be a boolean.")
    return {"enabled": enabled}


def _endpoint_override(key: str, value: dict[str, Any]) -> dict[str, Any]:
    if key not in _ENDPOINT_FEATURE_KEYS or "endpoint" not in value:
        return {}
    endpoint = value.get("endpoint")
    if endpoint is not None and not isinstance(endpoint, str):
        raise ValueError(f"Feature '{key}.endpoint' must be a string.")
    return {"endpoint": _normalize_url(endpoint)}


def _healthcheck_overrides(value: dict[str, Any]) -> dict[str, Any]:
    overrides: dict[str, Any] = {}
    if "mode" in value:
        mode = value.get("mode")
        if not isinstance(mode, str):
            raise ValueError("Feature 'healthcheck.mode' must be a string.")
        normalized_mode = mode.strip().lower()
        if normalized_mode not in {"http", "s3"}:
            raise ValueError("Feature 'healthcheck.mode' must be 'http' or 's3'.")
        overrides["mode"] = normalized_mode
    if "healthcheck_url" in value:
        url = value.get("healthcheck_url")
        if url is not None and not isinstance(url, str):
            raise ValueError("Feature 'healthcheck.healthcheck_url' must be a string.")
        overrides["url"] = _normalize_url(url)
    return overrides


def _normalize_feature_overrides(key: str, value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"Feature '{key}' must be a mapping.")
    _validate_feature_fields(key, value)
    overrides = _enabled_override(key, value)
    overrides.update(_endpoint_override(key, value))
    if key == "healthcheck":
        overrides.update(_healthcheck_overrides(value))
    return overrides


def _validate_provider_features(
    provider: StorageProvider,
    features: dict[str, dict[str, Any]],
) -> None:
    if provider == StorageProvider.CEPH:
        return
    for key in _CEPH_ONLY_FEATURE_KEYS:
        if features[key]["enabled"]:
            raise ValueError(f"Feature '{key}' is only available for Ceph endpoints.")


def normalize_features_config(
    provider: object,
    raw: Optional[str],
    region: Optional[object] = None,
) -> dict[str, dict[str, Any]]:
    normalized_provider = normalize_storage_provider(provider)
    features = _default_features(normalized_provider, region)
    raw_features = parse_features_config(raw)
    _validate_feature_names(raw_features)
    for key, value in raw_features.items():
        features[key].update(_normalize_feature_overrides(key, value))
    _validate_provider_features(normalized_provider, features)
    return features


def required_service_identity_kinds(features: dict[str, dict[str, Any]]) -> set[str]:
    """Operational identities needed by the endpoint's selected features."""
    required = set()
    if features["admin"]["enabled"] or features["account"]["enabled"]:
        required.add("runtime")
    healthcheck = features["healthcheck"]
    if (features["metrics"]["enabled"] or features["usage"]["enabled"]
            or (healthcheck["enabled"] and healthcheck["mode"] == "s3")):
        required.add("supervision")
    return required


def dump_features_config(features: dict[str, dict[str, Any]]) -> str:
    payload: dict[str, dict[str, dict[str, Any]]] = {"features": {}}
    for key in FEATURE_KEYS:
        entry: dict[str, Any] = {"enabled": bool(features.get(key, {}).get("enabled"))}
        endpoint = features.get(key, {}).get("endpoint")
        if key in {"admin", "sts", "iam"} and endpoint:
            entry["endpoint"] = endpoint
        if key == "healthcheck":
            mode = str(features.get(key, {}).get("mode") or "http").strip().lower()
            entry["mode"] = "s3" if mode == "s3" else "http"
            url = features.get(key, {}).get("url")
            if url:
                entry["healthcheck_url"] = url
        payload["features"][key] = entry
    dumped = yaml.safe_dump(payload, sort_keys=False, default_flow_style=False)
    return dumped.strip()


def resolve_feature_flags(endpoint: StorageEndpoint) -> EndpointFeatureFlags:
    features = normalize_features_config(
        endpoint.provider,
        endpoint.features_config,
        endpoint.region,
    )
    return EndpointFeatureFlags(
        admin_enabled=bool(features["admin"]["enabled"]),
        admin_endpoint=features["admin"].get("endpoint"),
        account_enabled=bool(features.get("account", {}).get("enabled")),
        sts_enabled=bool(features["sts"]["enabled"]),
        sts_endpoint=features["sts"].get("endpoint"),
        usage_enabled=bool(features["usage"]["enabled"]),
        metrics_enabled=bool(features["metrics"]["enabled"]),
        static_website_enabled=bool(features["static_website"]["enabled"]),
        iam_enabled=bool(features.get("iam", {}).get("enabled")),
        iam_endpoint=features.get("iam", {}).get("endpoint"),
        sns_enabled=bool(features.get("sns", {}).get("enabled")),
        sse_enabled=bool(features.get("sse", {}).get("enabled")),
        replication_enabled=bool(features.get("replication", {}).get("enabled")),
        healthcheck_enabled=bool(features.get("healthcheck", {}).get("enabled", True)),
        healthcheck_mode=str(features.get("healthcheck", {}).get("mode") or "http").strip().lower(),
        healthcheck_url=features.get("healthcheck", {}).get("url"),
    )


def resolve_admin_endpoint(endpoint: StorageEndpoint) -> Optional[str]:
    flags = resolve_feature_flags(endpoint)
    if not flags.admin_enabled:
        return None
    return resolve_rgw_admin_api_endpoint(endpoint)


def resolve_rgw_admin_api_endpoint(endpoint: StorageEndpoint) -> Optional[str]:
    flags = resolve_feature_flags(endpoint)
    return flags.admin_endpoint or endpoint.endpoint_url


def resolve_sts_endpoint(endpoint: StorageEndpoint) -> Optional[str]:
    flags = resolve_feature_flags(endpoint)
    if not flags.sts_enabled:
        return None
    provider = StorageProvider(endpoint.provider)
    if flags.sts_endpoint:
        return flags.sts_endpoint
    if provider == StorageProvider.AWS:
        return aws_sts_endpoint_for_region(endpoint.region)
    return endpoint.endpoint_url


def resolve_iam_endpoint(endpoint: StorageEndpoint) -> Optional[str]:
    flags = resolve_feature_flags(endpoint)
    if not flags.iam_enabled:
        return None
    if flags.iam_endpoint:
        return flags.iam_endpoint
    provider = StorageProvider(endpoint.provider)
    if provider == StorageProvider.AWS:
        return aws_iam_endpoint_for_region(endpoint.region)
    return endpoint.endpoint_url


def resolve_iam_signing_region(endpoint: StorageEndpoint) -> Optional[str]:
    provider = StorageProvider(endpoint.provider)
    region = endpoint.region
    if provider == StorageProvider.AWS:
        return aws_iam_signing_region_for_region(region)
    return region


def features_to_capabilities(features: dict[str, dict[str, Any]]) -> dict[str, bool]:
    return {
        "admin": bool(features.get("admin", {}).get("enabled")),
        "account": bool(features.get("account", {}).get("enabled")),
        "sts": bool(features.get("sts", {}).get("enabled")),
        "usage": bool(features.get("usage", {}).get("enabled")),
        "metrics": bool(features.get("metrics", {}).get("enabled")),
        "static_website": bool(features.get("static_website", {}).get("enabled")),
        "iam": bool(features.get("iam", {}).get("enabled")),
        "sns": bool(features.get("sns", {}).get("enabled")),
        "sse": bool(features.get("sse", {}).get("enabled")),
        "replication": bool(features.get("replication", {}).get("enabled")),
    }
