# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.quota_stats import extract_positive_limit, extract_quota_limits, parse_positive_limit


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


def test_extract_quota_limits_prefers_bytes_and_ignores_disabled_or_unlimited_values():
    assert extract_quota_limits(
        {
            "bucket_quota": {
                "enabled": True,
                "max_size": 4096,
                "max_size_kb": 8,
                "max_objects": 10,
            }
        },
        keys=("bucket_quota",),
    ) == (4096, 10)
    assert extract_quota_limits(
        {
            "bucket_quota": {
                "enabled": False,
                "max_size": 4096,
                "max_objects": 10,
            }
        },
        keys=("bucket_quota",),
    ) == (None, None)
    assert extract_quota_limits(
        {
            "bucket_quota": {
                "enabled": True,
                "max_size": 0,
                "max_size_kb": 0,
                "max_objects": -1,
            }
        },
        keys=("bucket_quota",),
    ) == (None, None)
