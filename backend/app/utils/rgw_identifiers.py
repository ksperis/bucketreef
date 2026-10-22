# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re
import secrets

_ACCOUNT_ID_PATTERN = re.compile(r"^RGW\d{17}$", re.IGNORECASE)
_ACCOUNT_ID_PREFIX_PATTERN = re.compile(r"^\d{1,3}$")


def generate_rgw_account_id(prefix: str) -> str:
    if not isinstance(prefix, str) or not _ACCOUNT_ID_PREFIX_PATTERN.fullmatch(prefix):
        raise ValueError("RGW account ID prefix must contain 1 to 3 digits.")
    random_digits = 17 - len(prefix)
    random_part = secrets.randbelow(10**random_digits)
    return f"RGW{prefix}{random_part:0{random_digits}d}"


def validate_rgw_account_name(name: str) -> str:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("Account name is required.")
    if "$" in name:
        raise ValueError("Account name must not contain '$'.")
    if ":" in name:
        raise ValueError("Account name must not contain ':'.")
    try:
        name.encode("utf-8", errors="strict")
    except UnicodeEncodeError as exc:
        raise ValueError("Account name must be valid UTF-8.") from exc
    return name


def is_rgw_account_id(identifier: str | None) -> bool:
    if not identifier:
        return False
    value = identifier.strip()
    return bool(value and _ACCOUNT_ID_PATTERN.match(value))


def validate_rgw_tenant(tenant: str) -> str:
    if tenant and not re.fullmatch(r"[A-Za-z0-9_]+", tenant):
        raise ValueError("Tenant must contain only ASCII letters, digits or underscores.")
    if re.fullmatch(r"RGW[0-9]{17}", tenant):
        raise ValueError("Tenant must not be a reserved RGW account ID.")
    return tenant


def normalize_rgw_bucket_reference_name(name: object) -> str:
    """Normalize an existing RGW bucket name without applying create-time DNS rules."""
    value = str(name or "").strip()
    if not value:
        raise ValueError("Bucket name is required.")
    if ":" in value or "/" in value:
        raise ValueError("Bucket name must be unqualified; provide the RGW tenant separately.")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Bucket name must not contain control characters.")
    return value


def validate_rgw_user_uid(uid: str, tenant: str | None = None) -> str:
    value = uid.strip()
    if not value:
        raise ValueError("UID is required.")
    parts = value.split("$", 2)
    parsed_tenant = parts[0] if len(parts) > 1 else ""
    namespace = parts[1] if len(parts) > 2 else ""
    identifier = parts[-1]
    effective_tenant = tenant.strip() if tenant and tenant.strip() else parsed_tenant
    validate_rgw_tenant(effective_tenant)
    if not identifier:
        raise ValueError("UID must contain a non-empty user identifier after '$'.")
    if re.fullmatch(r"RGW[0-9]{17}", identifier):
        raise ValueError("UID must not be a reserved RGW account ID.")
    if not effective_tenant and not namespace and identifier == "anonymous":
        raise ValueError("UID 'anonymous' is reserved.")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as exc:
        raise ValueError("UID must be valid UTF-8.") from exc
    return uid


def normalize_rgw_identifier(identifier: str | None) -> str | None:
    if identifier is None:
        return None
    value = str(identifier).strip()
    if not value:
        return None
    if is_rgw_account_id(value):
        return value.upper()
    return value.lower()


def resolve_account_scope(identifier: str | None) -> tuple[str | None, str | None]:
    if not identifier:
        return None, None
    value = identifier.strip()
    if not value:
        return None, None
    if is_rgw_account_id(value):
        return value, None
    return None, value
