# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Any, Dict, Optional, Tuple

from app.utils.rgw_payloads import (
    extract_rgw_account_payload,
    extract_rgw_user_payload,
    parse_rgw_bool,
    parse_rgw_int,
)


def parse_positive_limit(value: Any) -> Optional[int]:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        parsed = int(value)
    elif isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            parsed = int(float(normalized))
        except ValueError:
            return None
    else:
        return None
    return parsed if parsed > 0 else None


def extract_positive_limit(payload: Any, key: str) -> Optional[int]:
    if not isinstance(payload, dict):
        return None
    limits_payload = payload.get("limits") if isinstance(payload.get("limits"), dict) else {}
    return parse_positive_limit(payload.get(key) or limits_payload.get(key))


def extract_rgw_account_positive_limit(payload: Any, key: str) -> Optional[int]:
    return extract_positive_limit(extract_rgw_account_payload(payload), key)


def extract_rgw_account_limit(payload: Any, key: str) -> Optional[int]:
    account = extract_rgw_account_payload(payload)
    direct = parse_rgw_int(account.get(key))
    if direct is not None:
        return direct
    limits_payload = account.get("limits") if isinstance(account.get("limits"), dict) else {}
    return parse_rgw_int(limits_payload.get(key))


def extract_rgw_user_positive_limit(payload: Any, key: str) -> Optional[int]:
    if not isinstance(payload, dict):
        return None
    user_payload = extract_rgw_user_payload(payload)
    records = (user_payload, payload) if user_payload is not payload else (payload,)
    for record in records:
        parsed = parse_positive_limit(record.get(key))
        if parsed is not None:
            return parsed
    return None


def _first_quota_payload(
    payload: Dict[str, Any],
    keys: Tuple[str, ...],
) -> Optional[Dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            return value
    return None


def _positive_rgw_int(value: Any) -> Optional[int]:
    parsed = parse_rgw_int(value)
    return parsed if parsed is not None and parsed > 0 else None


def _quota_max_size_bytes(quota: Dict[str, Any]) -> Optional[int]:
    max_size = _positive_rgw_int(quota.get("max_size") or quota.get("max_size_bytes"))
    if max_size is not None:
        return max_size
    max_size_kb = _positive_rgw_int(quota.get("max_size_kb"))
    return max_size_kb * 1024 if max_size_kb is not None else None


def extract_quota_limits(
    payload: Optional[Dict[str, Any]],
    *,
    keys: Tuple[str, ...] = ("quota", "user_quota", "account_quota"),
) -> Tuple[Optional[int], Optional[int]]:
    if not isinstance(payload, dict):
        return None, None
    quota = _first_quota_payload(payload, keys)
    if quota is None:
        return None, None

    enabled = parse_rgw_bool(quota.get("enabled"))
    if enabled is False:
        return None, None

    return _quota_max_size_bytes(quota), _positive_rgw_int(quota.get("max_objects"))


def extract_rgw_account_quota_limits(payload: Any) -> Tuple[Optional[int], Optional[int]]:
    return extract_quota_limits(
        extract_rgw_account_payload(payload),
        keys=("quota", "account_quota"),
    )


def _rgw_user_quota_record(payload: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None
    user_payload = extract_rgw_user_payload(payload)
    records = (user_payload, payload) if user_payload is not payload else (payload,)
    keys = ("user_quota", "quota")
    for record in records:
        if _first_quota_payload(record, keys) is not None:
            return record
    return None


def extract_rgw_user_quota_enabled(payload: Any) -> Optional[bool]:
    record = _rgw_user_quota_record(payload)
    if record is None:
        return None
    quota = _first_quota_payload(record, ("user_quota", "quota"))
    if quota is None:
        return None
    return parse_rgw_bool(quota.get("enabled"))


def extract_rgw_user_quota_limits(payload: Any) -> Tuple[Optional[int], Optional[int]]:
    record = _rgw_user_quota_record(payload)
    if record is None:
        return None, None
    return extract_quota_limits(record, keys=("user_quota", "quota"))


def bytes_to_gb(value: Optional[int]) -> Optional[float]:
    if value is None:
        return None
    if value <= 0:
        return None
    gb = value / (1024 ** 3)
    return int(gb) if gb.is_integer() else round(gb, 3)
