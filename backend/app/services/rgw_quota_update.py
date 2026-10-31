# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Mapping

from app.core.sensitive_data import sanitized_error_log_detail
from app.services.rgw_admin import RGWAdminError
from app.utils.size_units import size_to_bytes


@dataclass(frozen=True)
class RgwQuotaUpdate:
    max_size_bytes: int | None
    max_objects: int | None
    enabled: bool


def prepare_rgw_quota_update(
    max_size_gb: float | None,
    max_objects: int | None,
    max_size_unit: str | None = None,
) -> RgwQuotaUpdate:
    try:
        max_size_bytes = size_to_bytes(max_size_gb, max_size_unit)
    except ValueError as exc:
        raise ValueError(sanitized_error_log_detail(exc)) from exc
    return RgwQuotaUpdate(
        max_size_bytes=max_size_bytes,
        max_objects=max_objects,
        enabled=max_size_bytes is not None or max_objects is not None,
    )


def validate_rgw_quota_update_response(
    response: Mapping[str, object],
    *,
    subject: str,
    identifier: str,
) -> None:
    if response.get("not_found"):
        raise ValueError(f"RGW {subject} not found for quota update: {identifier}")
    if response.get("not_implemented"):
        raise ValueError(f"RGW {subject} quota update is not supported on this cluster.")


def execute_rgw_quota_update(
    operation: Callable[[], Mapping[str, object]],
    *,
    subject: str,
    identifier: str,
) -> None:
    try:
        response = operation()
    except RGWAdminError as exc:
        raise ValueError(f"RGW {subject} quota update failed: {exc}") from exc
    validate_rgw_quota_update_response(
        response,
        subject=subject,
        identifier=identifier,
    )
