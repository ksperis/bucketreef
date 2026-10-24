# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest

from app.utils.rgw_caps import canonicalize_rgw_caps, parse_rgw_caps_permissions


@pytest.mark.parametrize(
    ("raw_caps", "expected"),
    [
        (
            "users=read,write;accounts=read,write",
            ["users=read,write", "accounts=read,write"],
        ),
        (
            [
                {"type": "users", "perm": "read,write"},
                {"scope": "usage", "permissions": "read"},
                {"type": "buckets"},
            ],
            ["users=read,write", "usage=read", "buckets=*"],
        ),
        (
            {"users": "read", "accounts": "read,write"},
            ["users=read", "accounts=read,write"],
        ),
        (
            ["users=read;accounts=read", "users=read"],
            ["users=read", "accounts=read"],
        ),
    ],
)
def test_canonicalize_rgw_caps_normalizes_supported_payload_shapes(raw_caps, expected):
    assert canonicalize_rgw_caps(raw_caps) == expected


def test_parse_rgw_caps_permissions_preserves_permission_lists():
    assert parse_rgw_caps_permissions(
        "users=read,write;accounts=read;usage=*"
    ) == {
        "users": {"read", "write"},
        "accounts": {"read"},
        "usage": {"*"},
    }
