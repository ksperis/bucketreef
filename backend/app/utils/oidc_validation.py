# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re


def normalize_trusted_email_domains(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        items = value.replace("\n", ",").split(",")
    elif isinstance(value, list):
        items = value
    else:
        raise ValueError("trusted_email_domains must be a list or comma-separated string")

    normalized: list[str] = []
    for item in items:
        domain = str(item or "").strip().lower().lstrip("@")
        if not domain:
            continue
        if len(domain) > 253 or "." not in domain or not re.fullmatch(r"[a-z0-9.-]+", domain):
            raise ValueError("trusted_email_domains must contain exact DNS domains")
        if domain not in normalized:
            normalized.append(domain)
    return normalized
