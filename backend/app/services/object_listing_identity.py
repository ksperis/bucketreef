# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any


def object_owner_label(entry: dict[str, Any]) -> str | None:
    """Return the most useful owner label exposed by an S3 listing entry."""
    owner = entry.get("Owner")
    if not isinstance(owner, dict):
        return None
    for field in ("DisplayName", "ID"):
        value = owner.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def is_current_folder_marker(*, key: str, prefix: str, size: int) -> bool:
    """Return whether an S3 listing entry is the marker for the selected prefix."""
    return bool(prefix) and key == prefix and key.endswith("/") and size == 0


def recursive_prefixes_for_key(
    key: str,
    *,
    current_prefix: str,
    is_folder_marker: bool,
) -> set[str]:
    """Derive literal parent prefixes without collapsing empty path segments."""
    start = len(current_prefix) if current_prefix and key.startswith(current_prefix) else 0
    prefixes: set[str] = set()
    for index in range(start, len(key)):
        if key[index] != "/":
            continue
        if index == len(key) - 1 and not is_folder_marker:
            continue
        prefix = key[: index + 1]
        if prefix != current_prefix:
            prefixes.add(prefix)
    return prefixes
