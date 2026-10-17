# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


def split_tenant_uid(value: str) -> tuple[str | None, str]:
    raw = value.strip()
    if "$" in raw:
        tenant, uid = raw.split("$", 1)
        if tenant and uid:
            return tenant, uid
    return None, raw
