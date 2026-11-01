# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, TypeVar

from app.utils.normalize import normalize_optional_scalar
from app.utils.rgw_payloads import extract_rgw_user_payload, parse_rgw_bool, parse_rgw_int

T = TypeVar("T")


def _extract_user_value(
    payload: dict[str, Any],
    keys: tuple[str, ...],
    parser: Callable[[Any], T | None],
    *,
    top_level_first: bool,
) -> T | None:
    user_payload = extract_rgw_user_payload(payload)
    records = (payload, user_payload) if top_level_first else (user_payload, payload)
    for key in keys:
        for record in records:
            value = parser(record.get(key))
            if value is not None:
                return value
    return None


def extract_user_scalar(
    payload: dict[str, Any],
    *keys: str,
    top_level_first: bool = False,
) -> str | None:
    return _extract_user_value(
        payload,
        tuple(keys),
        normalize_optional_scalar,
        top_level_first=top_level_first,
    )


def extract_user_bool(
    payload: dict[str, Any],
    key: str,
    *,
    top_level_first: bool = False,
) -> bool | None:
    return _extract_user_value(
        payload,
        (key,),
        parse_rgw_bool,
        top_level_first=top_level_first,
    )


def extract_user_int(
    payload: dict[str, Any],
    key: str,
    *,
    top_level_first: bool = False,
) -> int | None:
    return _extract_user_value(
        payload,
        (key,),
        parse_rgw_int,
        top_level_first=top_level_first,
    )
