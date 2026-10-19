# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any


_PROTECTED_ACCOUNT_PARAMS = {
    "id", "account-id", "name", "account-name", "email", "format",
    "tenant",
    "max-users", "max-buckets", "max-roles", "max-groups", "max-access-keys",
}


def validate_rgw_account_extra_params(value: dict[str, Any] | None) -> dict[str, Any] | None:
    """Keep identity and dedicated account fields out of the raw RGW parameter map."""
    if isinstance(value, dict) and any(
        str(key).strip().lower().replace("_", "-") in _PROTECTED_ACCOUNT_PARAMS
        for key in value
    ):
        raise ValueError("RGW account identity and dedicated fields cannot be overridden")
    return value
