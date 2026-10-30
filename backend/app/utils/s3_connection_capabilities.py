# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Any


DEFAULT_S3_CONNECTION_CAPABILITIES: dict[str, Any] = {"can_manage_iam": False}


def validate_s3_connection_capabilities(value: object) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("S3 connection capabilities must be a JSON object")
    if not isinstance(value.get("can_manage_iam"), bool):
        raise ValueError("S3 connection capabilities must define boolean can_manage_iam")
    return dict(value)


def s3_connection_can_manage_iam(value: object) -> bool:
    return validate_s3_connection_capabilities(value)["can_manage_iam"]


def with_s3_connection_can_manage_iam(
    value: object,
    *,
    can_manage_iam: bool,
) -> dict[str, Any]:
    caps = validate_s3_connection_capabilities(value)
    caps["can_manage_iam"] = bool(can_manage_iam)
    return caps
