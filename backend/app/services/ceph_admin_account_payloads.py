# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from app.models.ceph_admin import CephAdminRgwAccountDetail, CephAdminRgwQuotaConfig
from app.services.rgw_bucket_metadata import resolve_bucket_owner_identity
from app.utils.normalize import normalize_optional_scalar
from app.utils.quota_stats import extract_quota_limits, extract_rgw_account_limit
from app.utils.rgw_payloads import (
    extract_bucket_list,
    extract_rgw_account_email,
    extract_rgw_account_id,
    extract_rgw_account_name,
    extract_rgw_account_payload,
    extract_rgw_account_tenant,
    extract_rgw_quota_enabled,
    parse_rgw_int,
)


def extract_count(data: dict[str, Any], keys: tuple[str, ...]) -> Optional[int]:
    for key in keys:
        parsed = parse_rgw_int(data.get(key))
        if parsed is not None:
            return parsed
    return None


def extract_bucket_count(payload: dict[str, Any]) -> Optional[int]:
    account = extract_rgw_account_payload(payload)
    direct = extract_count(account, ("bucket_count", "num_buckets", "buckets_count"))
    if direct is not None:
        return direct
    stats = account.get("stats")
    if isinstance(stats, dict):
        from_stats = extract_count(stats, ("bucket_count", "num_buckets", "buckets_count"))
        if from_stats is not None:
            return from_stats
    buckets = account.get("bucket_list") or account.get("buckets")
    return len(buckets) if isinstance(buckets, list) else None


def extract_user_count(payload: dict[str, Any]) -> Optional[int]:
    account = extract_rgw_account_payload(payload)
    direct = extract_count(account, ("user_count", "users_count", "num_users", "users"))
    if direct is not None:
        return direct
    stats = account.get("stats")
    if isinstance(stats, dict):
        from_stats = extract_count(stats, ("user_count", "users_count", "num_users"))
        if from_stats is not None:
            return from_stats
    users = account.get("user_list")
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
    account = extract_rgw_account_payload(payload)
    max_size_bytes, max_objects = extract_quota_limits(account, keys=keys)
    enabled = extract_rgw_quota_enabled(account, keys=keys)
    if enabled is None and max_size_bytes is None and max_objects is None:
        return None
    return CephAdminRgwQuotaConfig(
        enabled=enabled,
        max_size_bytes=max_size_bytes,
        max_objects=max_objects,
    )


def build_account_detail(payload: dict[str, Any], account_id_fallback: str) -> CephAdminRgwAccountDetail:
    account_id = (
        extract_rgw_account_id(payload)
        or normalize_optional_scalar(account_id_fallback)
        or account_id_fallback
    )
    return CephAdminRgwAccountDetail(
        account_id=account_id,
        tenant=extract_rgw_account_tenant(payload),
        account_name=extract_rgw_account_name(payload),
        email=extract_rgw_account_email(payload),
        max_users=extract_rgw_account_limit(payload, "max_users"),
        max_buckets=extract_rgw_account_limit(payload, "max_buckets"),
        max_roles=extract_rgw_account_limit(payload, "max_roles"),
        max_groups=extract_rgw_account_limit(payload, "max_groups"),
        max_access_keys=extract_rgw_account_limit(payload, "max_access_keys"),
        bucket_count=extract_bucket_count(payload),
        user_count=extract_user_count(payload),
        quota=_quota_config(payload, keys=("quota", "account_quota")),
        bucket_quota=_quota_config(payload, keys=("bucket_quota",)),
    )
