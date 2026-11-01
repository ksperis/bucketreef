# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Any, Optional

from app.core.sensitive_data import sanitize_log_text


DB_ERROR_MESSAGE_MAX_CHARS = 16_384
DB_EVENT_MESSAGE_MAX_CHARS = 4_096
_DB_EVENT_METADATA_MAX_CHARS = 65_536
_DB_EVENT_METADATA_MAX_DEPTH = 8
_DB_EVENT_METADATA_MAX_ITEMS = 100


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, default=str)


def truncate_db_text(value: Any, *, max_chars: int) -> str:
    if max_chars <= 0:
        return ""
    text = "" if value is None else sanitize_log_text(value)
    if len(text) <= max_chars:
        return text
    omitted = len(text) - max_chars
    suffix = f"... [truncated {omitted} chars]"
    if len(suffix) >= max_chars:
        return suffix[:max_chars]
    return text[: max_chars - len(suffix)] + suffix


def truncate_optional_db_text(value: Optional[str], *, max_chars: int) -> Optional[str]:
    if value is None:
        return None
    return truncate_db_text(value, max_chars=max_chars)


def sanitize_event_metadata(value: Any, *, depth: int = 0) -> Any:
    if depth >= _DB_EVENT_METADATA_MAX_DEPTH:
        return truncate_db_text(value, max_chars=DB_EVENT_MESSAGE_MAX_CHARS)
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return truncate_db_text(value, max_chars=DB_EVENT_MESSAGE_MAX_CHARS)
    if isinstance(value, dict):
        safe_dict: dict[str, Any] = {}
        total_items = len(value)
        for index, (key, nested_value) in enumerate(value.items()):
            if index >= _DB_EVENT_METADATA_MAX_ITEMS:
                safe_dict["__truncated_items__"] = total_items - _DB_EVENT_METADATA_MAX_ITEMS
                break
            safe_key = truncate_db_text(key, max_chars=256)
            safe_dict[safe_key] = sanitize_event_metadata(nested_value, depth=depth + 1)
        return safe_dict
    if isinstance(value, (list, tuple, set)):
        entries = list(value)
        safe_entries = [
            sanitize_event_metadata(entry, depth=depth + 1)
            for entry in entries[:_DB_EVENT_METADATA_MAX_ITEMS]
        ]
        if len(entries) > _DB_EVENT_METADATA_MAX_ITEMS:
            safe_entries.append(
                f"[truncated {len(entries) - _DB_EVENT_METADATA_MAX_ITEMS} additional item(s)]"
            )
        return safe_entries
    return truncate_db_text(value, max_chars=DB_EVENT_MESSAGE_MAX_CHARS)


def bounded_event_metadata(
    metadata: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    if metadata is None:
        return None
    serialized = json_dumps(metadata)
    if len(serialized) <= _DB_EVENT_METADATA_MAX_CHARS:
        return metadata
    return {
        "truncated": True,
        "original_length": len(serialized),
        "preview": truncate_db_text(serialized, max_chars=1024),
    }
