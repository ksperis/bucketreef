# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from app.services.ceph_admin_errors import CephAdminUnsupportedError


def nullable_update(value: Any, field: str, field_set: set[str], cleared_value: Any) -> Any:
    if field not in field_set:
        return None
    return value if value is not None else cleared_value


def raise_if_unsupported(result: object, detail: str) -> None:
    if isinstance(result, dict) and (result.get("not_found") or result.get("not_implemented")):
        raise CephAdminUnsupportedError(detail)
