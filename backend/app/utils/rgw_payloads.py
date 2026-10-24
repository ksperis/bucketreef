# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.utils.normalize import normalize_optional_scalar, normalize_optional_string


def parse_rgw_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return None
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        if cleaned.isdigit() or (cleaned.startswith("-") and cleaned[1:].isdigit()):
            return int(cleaned)
    return None


def parse_rgw_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "y", "enabled", "enable", "on", "suspended"}:
            return True
        if normalized in {"false", "0", "no", "n", "disabled", "disable", "off", "active"}:
            return False
    return None


def extract_rgw_quota_enabled(
    payload: dict[str, Any],
    *,
    keys: tuple[str, ...],
) -> bool | None:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            parsed = parse_rgw_bool(value.get("enabled"))
            if parsed is not None:
                return parsed
    return None


def extract_rgw_account_ids(*records: object) -> set[str]:
    """Collect account identifiers from RGW response records.

    RGW account responses vary between ``id`` and ``account_id``. Keep both
    aliases visible so callers can reject conflicting provider identities.
    """
    return {
        account_id
        for record in records
        if isinstance(record, dict)
        for field in ("id", "account_id")
        if (account_id := normalize_optional_scalar(record.get(field)))
    }


def extract_rgw_account_tenant(payload: Any) -> str:
    """Return the account tenant while rejecting conflicting RGW payload fields."""
    if not isinstance(payload, dict):
        return ""
    candidates = [payload]
    nested = payload.get("account")
    if isinstance(nested, dict):
        candidates.append(nested)
    tenants = {
        str(candidate.get("tenant") or "").strip()
        for candidate in candidates
        if "tenant" in candidate
    }
    if len(tenants) > 1:
        raise ValueError("RGW returned conflicting account tenant identity fields")
    return next(iter(tenants), "")


def extract_bucket_list(payload: Any) -> list[dict]:
    def normalize(entries: list[Any]) -> list[dict]:
        normalized: list[dict] = []
        for entry in entries:
            if isinstance(entry, dict):
                normalized.append(entry)
            elif isinstance(entry, str):
                normalized.append({"name": entry})
        return normalized

    if isinstance(payload, list):
        return normalize(payload)
    if isinstance(payload, dict):
        buckets = payload.get("buckets")
        if isinstance(buckets, list):
            return normalize(buckets)
    return []


def extract_rgw_user_payload(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    user_payload = raw.get("user")
    if isinstance(user_payload, dict):
        return user_payload
    return raw


def rgw_user_account_root(payload: Any) -> bool | None:
    """Ceph Squid emits type=root; other supported payloads expose account_root."""
    user = extract_rgw_user_payload(payload)
    flag = user.get("account_root", user.get("account-root"))
    explicit = None if flag is None else flag in (True, "true", "True", "1", 1)
    if user.get("type") is not None:
        native = str(user["type"]).lower() == "root"
        if explicit is not None and explicit != native:
            raise ValueError("RGW returned conflicting account root identity fields")
        return native
    return explicit


_RGW_USER_ID_FIELDS = ("uid", "user_id", "user")


def _rgw_user_identity_candidates(payload: dict[str, Any]) -> list[dict[str, Any]]:
    candidates = [payload]
    nested_user = payload.get("user")
    if isinstance(nested_user, dict):
        candidates.append(nested_user)
    return candidates


def _collect_rgw_user_identity(
    candidate: dict[str, Any],
    *,
    uids: set[str],
    tenants: set[str],
) -> None:
    explicit_tenant = normalize_optional_scalar(candidate.get("tenant"))
    if explicit_tenant:
        tenants.add(explicit_tenant)

    for field in _RGW_USER_ID_FIELDS:
        raw_value = candidate.get(field)
        if not isinstance(raw_value, str):
            continue
        uid = normalize_optional_string(raw_value)
        if not uid:
            continue
        if "$" in uid:
            embedded_tenant, uid = (part.strip() for part in uid.split("$", 1))
            if not embedded_tenant or not uid:
                raise ValueError("RGW returned an invalid tenant-qualified user identity")
            tenants.add(embedded_tenant)
        uids.add(uid)


def extract_rgw_user_identity(payload: Any) -> tuple[str | None, str | None]:
    if not isinstance(payload, dict):
        return None, None
    uids: set[str] = set()
    tenants: set[str] = set()
    for candidate in _rgw_user_identity_candidates(payload):
        _collect_rgw_user_identity(candidate, uids=uids, tenants=tenants)
    if len(tenants) > 1:
        raise ValueError("RGW returned conflicting tenant identity fields")
    if len(uids) > 1:
        raise ValueError("RGW returned conflicting user identity fields")
    return next(iter(uids), None), next(iter(tenants), None)


def rgw_qualified_uid(uid: str, tenant: str | None = None) -> str:
    """Admin Ops parse the tenant from uid; a separate tenant argument is insufficient."""
    normalized_uid = uid.strip()
    if not normalized_uid:
        raise ValueError("RGW UID is required")
    normalized_tenant = (tenant or "").strip()
    if "$" in normalized_uid:
        embedded_tenant, _bare_uid = normalized_uid.split("$", 1)
        if normalized_tenant and embedded_tenant != normalized_tenant:
            raise ValueError("RGW UID tenant conflicts with the requested tenant")
        return normalized_uid
    if not normalized_tenant:
        return normalized_uid
    return f"{normalized_tenant}${normalized_uid}"


def require_rgw_user_identity(payload: Any, uid: str, tenant: str) -> None:
    """Reject mismatched principals before using Admin Ops returned credentials.

    RGW may encode the tenant either in its own field or in tenant$uid.
    For a non-default tenant, an unqualified response cannot prove isolation.
    """
    actual_uid, actual_tenant = extract_rgw_user_identity(payload)
    if not actual_uid or actual_uid != uid:
        raise ValueError("RGW returned a different user identity")
    if actual_tenant and actual_tenant != tenant:
        raise ValueError("RGW returned a user from another tenant")
    if tenant and actual_tenant != tenant:
        raise ValueError("RGW did not confirm the requested tenant and UID")


def split_rgw_tenant_uid(value: str, tenant: str | None = None) -> tuple[str, str]:
    raw = value.strip()
    explicit_tenant = (tenant or "").strip()
    if "$" in raw:
        embedded_tenant, raw = raw.split("$", 1)
        if not embedded_tenant or not raw or (explicit_tenant and embedded_tenant != explicit_tenant):
            raise ValueError("RGW tenant-qualified UID is invalid or conflicts with the tenant")
        explicit_tenant = embedded_tenant
    from app.utils.rgw_identifiers import validate_rgw_user_uid, validate_rgw_tenant
    validate_rgw_user_uid(raw, explicit_tenant)
    validate_rgw_tenant(explicit_tenant)
    return raw, explicit_tenant
