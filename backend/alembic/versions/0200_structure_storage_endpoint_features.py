# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

"""Store Storage Endpoint features as structured JSON.

Revision ID: 0200_structure_storage_endpoint_features
Revises: 0199_normalize_s3_connection_custom_endpoints
Create Date: 2026-10-30
"""

from __future__ import annotations

from typing import Any

from alembic import op
import sqlalchemy as sa
import yaml


revision = "0200_structure_storage_endpoint_features"
down_revision = "0199_normalize_s3_connection_custom_endpoints"
branch_labels = None
depends_on = None


FEATURE_KEYS = (
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
ENDPOINT_FEATURE_KEYS = frozenset({"admin", "iam", "sts"})
CEPH_ONLY_FEATURE_KEYS = (
    "admin",
    "account",
    "usage",
    "metrics",
    "sns",
    "replication",
)
AWS_DEFAULT_REGION = "us-east-1"
AWS_IAM_ENDPOINT = "https://iam.amazonaws.com"
AWS_GOV_IAM_ENDPOINT = "https://iam.us-gov.amazonaws.com"
AWS_CN_IAM_ENDPOINT = "https://iam.cn-north-1.amazonaws.com.cn"


storage_endpoints = sa.table(
    "storage_endpoints",
    sa.column("id", sa.Integer()),
    sa.column("provider", sa.String()),
    sa.column("region", sa.String()),
    sa.column("features_config", sa.Text()),
    sa.column("features", sa.JSON()),
)


def _normalize_region(value: object | None) -> str:
    normalized = str(value or "").strip().lower()
    return normalized or AWS_DEFAULT_REGION


def _aws_dns_suffix(region: str) -> str:
    return "amazonaws.com.cn" if region.startswith("cn-") else "amazonaws.com"


def _aws_sts_endpoint(region: str) -> str:
    return f"https://sts.{region}.{_aws_dns_suffix(region)}"


def _aws_iam_endpoint(region: str) -> str:
    if region.startswith("cn-"):
        return AWS_CN_IAM_ENDPOINT
    if region.startswith("us-gov-"):
        return AWS_GOV_IAM_ENDPOINT
    return AWS_IAM_ENDPOINT


def _defaults(provider: str, region: object | None) -> dict[str, dict[str, Any]]:
    enabled = {
        "admin": False,
        "account": False,
        "sts": provider == "aws",
        "usage": False,
        "metrics": False,
        "static_website": provider == "aws",
        "iam": provider == "aws",
        "sns": False,
        "sse": provider == "aws",
        "replication": False,
    }
    features = {key: {"enabled": value} for key, value in enabled.items()}
    for key in ENDPOINT_FEATURE_KEYS:
        features[key]["endpoint"] = None
    features["healthcheck"] = {"enabled": True, "mode": "http", "url": None}
    if provider == "aws":
        normalized_region = _normalize_region(region)
        features["sts"]["endpoint"] = _aws_sts_endpoint(normalized_region)
        features["iam"]["endpoint"] = _aws_iam_endpoint(normalized_region)
    return features


def _normalize_url(value: object | None, *, label: str) -> str | None:
    if value is not None and not isinstance(value, str):
        raise ValueError(f"{label} must be a string.")
    normalized = str(value or "").strip().rstrip("/")
    return normalized or None


def _load_overrides(endpoint_id: int, raw: str | None) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    try:
        document = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise ValueError(f"Storage Endpoint {endpoint_id} has invalid features YAML.") from exc
    if not isinstance(document, dict) or set(document) != {"features"}:
        raise ValueError(
            f"Storage Endpoint {endpoint_id} features YAML must contain only the 'features' mapping."
        )
    features = document["features"]
    if not isinstance(features, dict):
        raise ValueError(f"Storage Endpoint {endpoint_id} features must be a mapping.")
    unknown = set(features).difference(FEATURE_KEYS)
    if unknown:
        raise ValueError(
            f"Storage Endpoint {endpoint_id} has unknown feature(s): {', '.join(sorted(unknown))}."
        )
    return features


def _normalized_features(
    endpoint_id: int,
    provider: str,
    region: object | None,
    raw: str | None,
) -> dict[str, dict[str, Any]]:
    features = _defaults(provider, region)
    for key, value in _load_overrides(endpoint_id, raw).items():
        if not isinstance(value, dict):
            raise ValueError(f"Storage Endpoint {endpoint_id} feature '{key}' must be a mapping.")
        allowed = {"enabled"}
        if key in ENDPOINT_FEATURE_KEYS:
            allowed.add("endpoint")
        if key == "healthcheck":
            allowed.update({"healthcheck_url", "mode"})
        unknown = set(value).difference(allowed)
        if unknown:
            raise ValueError(
                f"Storage Endpoint {endpoint_id} feature '{key}' has unknown field(s): "
                f"{', '.join(sorted(unknown))}."
            )
        if "enabled" in value:
            if not isinstance(value["enabled"], bool):
                raise ValueError(
                    f"Storage Endpoint {endpoint_id} feature '{key}.enabled' must be a boolean."
                )
            features[key]["enabled"] = value["enabled"]
        if key in ENDPOINT_FEATURE_KEYS and "endpoint" in value:
            features[key]["endpoint"] = _normalize_url(
                value["endpoint"],
                label=f"Storage Endpoint {endpoint_id} feature '{key}.endpoint'",
            )
        if key == "healthcheck":
            if "mode" in value:
                mode = value["mode"]
                if not isinstance(mode, str) or mode.strip().lower() not in {"http", "s3"}:
                    raise ValueError(
                        f"Storage Endpoint {endpoint_id} feature 'healthcheck.mode' must be 'http' or 's3'."
                    )
                features[key]["mode"] = mode.strip().lower()
            if "healthcheck_url" in value:
                features[key]["url"] = _normalize_url(
                    value["healthcheck_url"],
                    label=f"Storage Endpoint {endpoint_id} feature 'healthcheck.healthcheck_url'",
                )
    if provider != "ceph":
        for key in CEPH_ONLY_FEATURE_KEYS:
            if features[key]["enabled"]:
                raise ValueError(
                    f"Storage Endpoint {endpoint_id} feature '{key}' is only available for Ceph endpoints."
                )
    return features


def _features_config(features: dict[str, dict[str, Any]]) -> str:
    document: dict[str, dict[str, dict[str, Any]]] = {"features": {}}
    for key in FEATURE_KEYS:
        source = features[key]
        entry: dict[str, Any] = {"enabled": bool(source.get("enabled"))}
        if key in ENDPOINT_FEATURE_KEYS and source.get("endpoint"):
            entry["endpoint"] = source["endpoint"]
        if key == "healthcheck":
            entry["mode"] = "s3" if source.get("mode") == "s3" else "http"
            if source.get("url"):
                entry["healthcheck_url"] = source["url"]
        document["features"][key] = entry
    return yaml.safe_dump(document, sort_keys=False, default_flow_style=False).strip()


def upgrade() -> None:
    op.add_column("storage_endpoints", sa.Column("features", sa.JSON(), nullable=True))
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(
            storage_endpoints.c.id,
            storage_endpoints.c.provider,
            storage_endpoints.c.region,
            storage_endpoints.c.features_config,
        )
    ).all()
    for row in rows:
        bind.execute(
            storage_endpoints.update()
            .where(storage_endpoints.c.id == row.id)
            .values(
                features=_normalized_features(
                    row.id,
                    row.provider,
                    row.region,
                    row.features_config,
                )
            )
        )
    with op.batch_alter_table("storage_endpoints") as batch_op:
        batch_op.alter_column("features", existing_type=sa.JSON(), nullable=False)
        batch_op.drop_column("features_config")


def downgrade() -> None:
    with op.batch_alter_table("storage_endpoints") as batch_op:
        batch_op.add_column(sa.Column("features_config", sa.Text(), nullable=True))
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(storage_endpoints.c.id, storage_endpoints.c.features)
    ).all()
    for row in rows:
        bind.execute(
            storage_endpoints.update()
            .where(storage_endpoints.c.id == row.id)
            .values(features_config=_features_config(row.features))
        )
    with op.batch_alter_table("storage_endpoints") as batch_op:
        batch_op.drop_column("features")
