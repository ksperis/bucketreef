# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.models.bucket_filter import BucketFilterRule
from app.services.bucket_listing_shared import coerce_filter_bool, coerce_filter_number
from app.utils.normalize import normalize_text


def feature_param_quantifier(rule: BucketFilterRule) -> str:
    return "none" if (rule.quantifier or "").strip().lower() == "none" else "any"


def match_text_value(left: str | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = normalize_text(str(right_raw or ""))
    if not right:
        return False
    left_norm = normalize_text(left)
    if op == "eq":
        return left_norm == right
    if op == "neq":
        return left_norm != right
    if op == "contains":
        return right in left_norm
    if op == "starts_with":
        return left_norm.startswith(right)
    if op == "ends_with":
        return left_norm.endswith(right)
    return False


def match_numeric_value(left: float | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = coerce_filter_number(right_raw)
    if right is None:
        return False
    if op == "eq":
        return left == right
    if op == "neq":
        return left != right
    if op == "gt":
        return left > right
    if op == "gte":
        return left >= right
    if op == "lt":
        return left < right
    if op == "lte":
        return left <= right
    return False


def match_bool_value(left: bool | None, op: str, right_raw: object) -> bool:
    if left is None:
        return False
    right = coerce_filter_bool(right_raw)
    if right is None:
        return False
    if op == "eq":
        return left is right
    if op == "neq":
        return left is not right
    return False
