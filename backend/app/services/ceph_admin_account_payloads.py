# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.models.ceph_admin import CephAdminRgwAccountDetail, CephAdminRgwQuotaConfig
from app.services.rgw_bucket_metadata import resolve_bucket_owner_identity
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits
from app.utils.rgw_payloads import (
    extract_bucket_list,
    extract_rgw_account_tenant,
    parse_rgw_bool,
    parse_rgw_int,
)


def extract_count(data: dict[str, Any], keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        parsed = parse_rgw_int(data.get(key))
        if parsed is not None:
            return parsed
    return None


def extract_bucket_count(payload: dict[str, Any]) -> Optional[int]:
    direct = extract_count(payload, ("bucket_count", "num_buckets", "buckets_count"))
    if direct is not None:
        return direct
    stats = payload.get("stats")
    if isinstance(stats, dict):
        from_stats = extract_count(stats, ("bucket_count", "num_buckets", "buckets_count"))
        if from_stats is not None:
            return from_stats
    buckets = payload.get("bucket_list") or payload.get("buckets")
    return len(buckets) if isinstance(buckets, list) else None


def extract_user_count(payload: dict[str, Any]) -> Optional[int]:
    direct = extract_count(payload, ("user_count", "users_count", "num_users", "users"))
    if direct is not None:
        return direct
    stats = payload.get("stats")
    if isinstance(stats, dict):
        from_stats = extract_count(stats, ("user_count", "users_count", "num_users"))
        if from_stats is not None:
            return from_stats
    users = payload.get("user_list")
    return len(users) if isinstance(users, list) else None


def extract_account_bucket_list(payload: Any, account_id: str) -> list[dict]:
    """Defensively scope an RGW bucket listing to one account."""
    normalized_account_id = account_id.strip()
    entries = extract_bucket_list(payload)
    if not normalized_account_id or not entries:
        return entries

    matched: list[dict] = []
    ownership_metadata_seen = False
    for entry in entries:
        explicit_account_id = normalize_optional_scalar(
            entry.get("account_id") or entry.get("account-id")
        )
        owner = normalize_optional_scalar(entry.get("owner"))
        if explicit_account_id or owner:
            ownership_metadata_seen = True
        if explicit_account_id:
            if explicit_account_id == normalized_account_id:
                matched.append(entry)
            continue
        if owner == normalized_account_id:
            matched.append(entry)
            continue
        owner_account_id, _owner_uid = resolve_bucket_owner_identity(entry)
        if owner_account_id == normalized_account_id:
            matched.append(entry)

    return matched if ownership_metadata_seen else entries


def _quota_config(
    payload: dict[str, Any],
    *,
    keys: tuple[str, ...],
) -> Optional[CephAdminRgwQuotaConfig]:
    max_size_bytes, max_objects = extract_quota_limits(payload, keys=keys)
    enabled = _extract_quota_enabled(payload, keys=keys)
    if enabled is None and max_size_bytes is None and max_objects is None:
        return None
    return CephAdminRgwQuotaConfig(
        enabled=enabled,
        max_size_bytes=max_size_bytes,
        max_objects=max_objects,
    )


def _account_limit(
    payload: dict[str, Any],
    limits_payload: dict[str, Any],
    key: str,
) -> Optional[int]:
    direct = parse_rgw_int(payload.get(key))
    if direct is not None:
        return direct
    return parse_rgw_int(limits_payload.get(key))


def build_account_detail(payload: dict[str, Any], account_id_fallback: str) -> CephAdminRgwAccountDetail:
    account_id = normalize_optional_scalar(payload.get("id") or payload.get("account_id")) or account_id_fallback
    limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    return CephAdminRgwAccountDetail(
        account_id=account_id,
        tenant=extract_rgw_account_tenant(payload),
        account_name=normalize_optional_scalar(
            payload.get("name") or payload.get("account_name") or payload.get("display_name")
        ),
        email=normalize_optional_scalar(payload.get("email") or payload.get("mail")),
        max_users=_account_limit(payload, limits_payload, "max_users"),
        max_buckets=_account_limit(payload, limits_payload, "max_buckets"),
        max_roles=_account_limit(payload, limits_payload, "max_roles"),
        max_groups=_account_limit(payload, limits_payload, "max_groups"),
        max_access_keys=_account_limit(payload, limits_payload, "max_access_keys"),
        bucket_count=extract_bucket_count(payload),
        user_count=extract_user_count(payload),
        quota=_quota_config(payload, keys=("quota", "account_quota")),
        bucket_quota=_quota_config(payload, keys=("bucket_quota",)),
    )


def _extract_quota_enabled(
    payload: dict[str, Any],
    keys: tuple[str, ...] = ("quota", "account_quota"),
) -> Optional[bool]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            parsed = parse_rgw_bool(value.get("enabled"))
            if parsed is not None:
                return parsed
    return None
