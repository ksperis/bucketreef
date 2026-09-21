# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal


RgwCredentialFailureKind = Literal["denied", "unavailable"]


def classify_rgw_credential_failure(error: Exception) -> RgwCredentialFailureKind:
    normalized = str(error).lower()
    denied_markers = (
        "401",
        "403",
        "accessdenied",
        "access denied",
        "invalidaccesskey",
        "invalid access key",
        "signature",
    )
    return "denied" if any(marker in normalized for marker in denied_markers) else "unavailable"


def extract_ceph_admin_flags(user_payload: dict) -> tuple[bool, bool]:
    candidates: list[dict] = [user_payload]
    nested_user = user_payload.get("user")
    if isinstance(nested_user, dict):
        candidates.append(nested_user)
    admin = any(_to_bool(candidate.get("admin")) for candidate in candidates)
    system = any(_to_bool(candidate.get("system")) for candidate in candidates)
    return admin, system


def _to_bool(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y", "on"}
    return False
