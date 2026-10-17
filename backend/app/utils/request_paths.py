# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations


def path_matches_prefix(path: str, prefix: str) -> bool:
    normalized = prefix.rstrip("/")
    return path == normalized or path.startswith(f"{normalized}/")


def relative_path_from_prefix(path: str, prefix: str) -> str | None:
    normalized = prefix.rstrip("/")
    if not path_matches_prefix(path, normalized):
        return None
    return path[len(normalized) :]
