# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re

from app.utils.normalize import normalize_optional_scalar


def _append_cap_expression(result: list[str], expression: object) -> None:
    normalized = normalize_optional_scalar(expression)
    if not normalized:
        return
    result.extend(
        part
        for raw_part in normalized.split(";")
        if (part := raw_part.strip())
    )


def _structured_cap_expression(entry: dict[object, object]) -> str | None:
    scope = normalize_optional_scalar(entry.get("type") or entry.get("scope"))
    if not scope:
        return None
    permissions = normalize_optional_scalar(
        entry.get("perm") or entry.get("permissions")
    )
    return f"{scope}={permissions or '*'}"


def canonicalize_rgw_caps(raw_caps: object) -> list[str]:
    """Normalize supported RGW caps payload shapes into ordered cap expressions."""
    expressions: list[str] = []
    if isinstance(raw_caps, str):
        _append_cap_expression(expressions, raw_caps)
    elif isinstance(raw_caps, list):
        for entry in raw_caps:
            if isinstance(entry, str):
                _append_cap_expression(expressions, entry)
            elif isinstance(entry, dict):
                _append_cap_expression(expressions, _structured_cap_expression(entry))
    elif isinstance(raw_caps, dict):
        for scope, permissions in raw_caps.items():
            normalized_scope = normalize_optional_scalar(scope)
            if not normalized_scope:
                continue
            normalized_permissions = normalize_optional_scalar(permissions) or "*"
            expressions.append(f"{normalized_scope}={normalized_permissions}")
    return list(dict.fromkeys(expressions))


def parse_rgw_caps_permissions(raw_caps: object) -> dict[str, set[str]]:
    """Return normalized RGW cap permissions keyed by lowercase scope."""
    parsed: dict[str, set[str]] = {}
    for expression in canonicalize_rgw_caps(raw_caps):
        scope, separator, permissions = expression.partition("=")
        if not separator:
            continue
        normalized_scope = scope.strip().lower()
        if not normalized_scope:
            continue
        tokens = {
            token.strip().lower()
            for token in re.split(r"[,\s]+", permissions)
            if token.strip()
        }
        parsed.setdefault(normalized_scope, set()).update(tokens or {"*"})
    return parsed
