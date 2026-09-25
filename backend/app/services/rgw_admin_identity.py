# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from typing import Literal

from app.services.rgw_admin_transport import RGWAdminError


RgwCredentialFailureKind = Literal["denied", "unavailable"]
_DENIED_ERROR_CODES = {
    "accessdenied",
    "invalidaccesskey",
    "invalidaccesskeyid",
    "signaturedoesnotmatch",
}


def classify_rgw_credential_failure(error: RGWAdminError) -> RgwCredentialFailureKind:
    error_code = (error.error_code or "").strip().lower()
    if error.status_code in {401, 403} or error_code in _DENIED_ERROR_CODES:
        return "denied"
    return "unavailable"


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
