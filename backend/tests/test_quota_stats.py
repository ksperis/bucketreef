# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.quota_stats import extract_positive_limit, extract_quota_snapshot, parse_positive_limit


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (12, 12),
        (12.9, 12),
        (" 12 ", 12),
        ("12.9", 12),
        (None, None),
        (True, None),
        (0, None),
        (-1, None),
        ("", None),
        ("invalid", None),
        ({"value": 12}, None),
    ],
)
def test_parse_positive_limit(value, expected):
    assert parse_positive_limit(value) == expected


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        ({"max_buckets": 12}, 12),
        ({"limits": {"max_buckets": " 8 "}}, 8),
        ({"max_buckets": 0, "limits": {"max_buckets": 6}}, 6),
        ({"limits": "invalid"}, None),
        (None, None),
    ],
)
def test_extract_positive_limit(payload, expected):
    assert extract_positive_limit(payload, "max_buckets") == expected


@pytest.mark.parametrize(
    ("quota", "expected_state", "expected_bytes"),
    [
        ({"enabled": True, "max_size": 1024}, "valid", 1024),
        ({"enabled": False, "max_size": 1024}, "disabled", None),
        ({"enabled": True, "max_size": -1}, "unlimited", None),
        ({"enabled": True, "max_size": 0}, "unlimited", None),
        ({"enabled": True, "max_size": "invalid"}, "invalid", None),
        ({"enabled": True}, "unlimited", None),
    ],
)
def test_extract_quota_snapshot_preserves_billing_state(quota, expected_state, expected_bytes):
    snapshot = extract_quota_snapshot({"quota": quota})

    assert snapshot.size_state == expected_state
    assert snapshot.max_size_bytes == expected_bytes


def test_extract_quota_snapshot_distinguishes_missing_quota_payload():
    snapshot = extract_quota_snapshot({})

    assert snapshot.size_state == "missing"
    assert snapshot.max_size_bytes is None
