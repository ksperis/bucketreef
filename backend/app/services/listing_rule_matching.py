# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from operator import eq, ge, gt, le, lt, ne

from app.utils.normalize import normalize_text

TextNormalizer = Callable[[object], str | None]
NumberCoercer = Callable[[object], float | None]
BooleanCoercer = Callable[[object], bool | None]

_TEXT_COMPARATORS = {
    "contains": lambda left, right: right in left,
    "starts_with": str.startswith,
    "ends_with": str.endswith,
    "eq": eq,
    "neq": ne,
}
_EQUALITY_COMPARATORS = {
    "eq": eq,
    "neq": ne,
}
_NUMERIC_COMPARATORS = {
    **_EQUALITY_COMPARATORS,
    "gt": gt,
    "gte": ge,
    "lt": lt,
    "lte": le,
}


def _normalize_scalar_text(value: object) -> str:
    return normalize_text(str(value or ""))


def _normalize_candidate_text(value: object) -> str:
    return normalize_text(str(value))


def match_text_rule(
    value: object,
    op: str,
    expected: object,
    *,
    scalar_normalizer: TextNormalizer = _normalize_scalar_text,
    candidate_normalizer: TextNormalizer = _normalize_candidate_text,
    require_candidates: bool = False,
) -> bool:
    if value is None:
        return False
    left = normalize_text(str(value))
    comparator = _TEXT_COMPARATORS.get(op)
    if comparator is not None:
        right = scalar_normalizer(expected)
        return right is not None and comparator(left, right)
    if op not in {"in", "not_in"} or not isinstance(expected, list):
        return False
    candidates = {
        normalized
        for item in expected
        if (normalized := candidate_normalizer(item)) is not None
    }
    if require_candidates and not candidates:
        return False
    matched = left in candidates
    return matched if op == "in" else not matched


def match_numeric_rule(
    value: object,
    op: str,
    expected: object,
    *,
    coerce: NumberCoercer,
) -> bool:
    left = coerce(value)
    if left is None:
        return False
    comparator = _NUMERIC_COMPARATORS.get(op)
    if comparator is not None:
        right = coerce(expected)
        return right is not None and comparator(left, right)
    if op not in {"in", "not_in"} or not isinstance(expected, list):
        return False
    candidates = {
        candidate
        for item in expected
        if (candidate := coerce(item)) is not None
    }
    matched = left in candidates
    return matched if op == "in" else not matched


def match_boolean_rule(
    value: object,
    op: str,
    expected: object,
    *,
    coerce: BooleanCoercer,
    default_if_none: bool | None = None,
) -> bool:
    left = coerce(value)
    if left is None:
        left = default_if_none
    if left is None:
        return False
    comparator = _EQUALITY_COMPARATORS.get(op)
    if comparator is not None:
        right = coerce(expected)
        return right is not None and comparator(left, right)
    if op not in {"in", "not_in"} or not isinstance(expected, list):
        return False
    candidates = {
        candidate
        for item in expected
        if (candidate := coerce(item)) is not None
    }
    matched = left in candidates
    return matched if op == "in" else not matched
