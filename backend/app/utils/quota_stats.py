# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import dataclass
from typing import Any, Dict, Literal, Optional, Tuple


QuotaSizeState = Literal["valid", "missing", "disabled", "unlimited", "invalid"]


@dataclass(frozen=True)
class QuotaSnapshot:
    max_size_bytes: Optional[int]
    max_objects: Optional[int]
    size_state: QuotaSizeState


def _parse_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "enabled", "enable"}:
            return True
        if normalized in {"false", "0", "no", "disabled", "disable"}:
            return False
    return None


def _parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            return int(float(normalized))
        except ValueError:
            return None
    return None


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


def extract_quota_limits(
    payload: Optional[Dict[str, Any]],
    *,
    keys: Tuple[str, ...] = ("quota", "user_quota", "account_quota"),
) -> Tuple[Optional[int], Optional[int]]:
    snapshot = extract_quota_snapshot(payload, keys=keys)
    return snapshot.max_size_bytes, snapshot.max_objects


def extract_quota_snapshot(
    payload: Optional[Dict[str, Any]],
    *,
    keys: Tuple[str, ...] = ("quota", "user_quota", "account_quota"),
) -> QuotaSnapshot:
    if not isinstance(payload, dict):
        return QuotaSnapshot(None, None, "missing")
    quota: Optional[Dict[str, Any]] = None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, dict):
            quota = value
            break
    if not isinstance(quota, dict):
        return QuotaSnapshot(None, None, "missing")

    enabled = _parse_bool(quota.get("enabled"))
    if enabled is False:
        return QuotaSnapshot(None, None, "disabled")

    raw_size = quota.get("max_size")
    if raw_size is None:
        raw_size = quota.get("max_size_bytes")
    raw_size_kb = quota.get("max_size_kb")
    max_size = _parse_int(raw_size)
    if max_size is None and raw_size_kb is not None:
        parsed_kb = _parse_int(raw_size_kb)
        if parsed_kb is not None:
            max_size = parsed_kb * 1024

    max_objects = _parse_int(quota.get("max_objects"))
    if max_objects is not None and max_objects <= 0:
        max_objects = None

    if max_size is not None and max_size > 0:
        return QuotaSnapshot(max_size, max_objects, "valid")
    if raw_size is not None or raw_size_kb is not None:
        parsed_raw_size = _parse_int(raw_size)
        parsed_raw_kb = _parse_int(raw_size_kb)
        if parsed_raw_size is None and parsed_raw_kb is None:
            return QuotaSnapshot(None, max_objects, "invalid")
        return QuotaSnapshot(None, max_objects, "unlimited")
    return QuotaSnapshot(None, max_objects, "unlimited")


def bytes_to_gb(value: Optional[int]) -> Optional[float]:
    if value is None:
        return None
    if value <= 0:
        return None
    gb = value / (1024 ** 3)
    return int(gb) if gb.is_integer() else round(gb, 3)
