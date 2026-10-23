# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import pytest

from app.services.key_rotation_rgw import RgwAccessKeyRotator
from app.services.rgw_admin import RGWAdminError


class _Admin:
    def __init__(self, payload=None, *, error: Exception | None = None) -> None:
        self.payload = payload
        self.error = error

    def get_user_by_access_key(self, _access_key: str, *, allow_not_found: bool = False):
        assert allow_not_found is True
        if self.error is not None:
            raise self.error
        return self.payload


@pytest.mark.parametrize(
    "payload,expected",
    [
        ({"uid": "alice", "tenant": "research"}, ("alice", "research")),
        ({"user": {"user_id": "alice", "tenant": "research"}}, ("alice", "research")),
        ({"uid": "research$alice"}, ("alice", "research")),
        ({"user": {"uid": "research$alice"}, "tenant": "research"}, ("alice", "research")),
    ],
)
def test_resolve_identity_from_access_key_normalizes_rgw_payloads(payload, expected):
    assert RgwAccessKeyRotator().resolve_identity_from_access_key(_Admin(payload), "access") == expected


def test_resolve_identity_from_access_key_rejects_conflicting_tenant():
    with pytest.raises(ValueError, match="conflicting tenants"):
        RgwAccessKeyRotator().resolve_identity_from_access_key(
            _Admin({"uid": "tenant-a$alice", "tenant": "tenant-b"}),
            "access",
        )


@pytest.mark.parametrize("payload", [None, {}, {"tenant": "research"}])
def test_resolve_identity_from_access_key_rejects_missing_identity(payload):
    expected = (
        "Access key is not associated with an RGW user"
        if not payload
        else "Unable to resolve RGW user identity"
    )
    with pytest.raises(ValueError, match=expected):
        RgwAccessKeyRotator().resolve_identity_from_access_key(_Admin(payload), "access")


def test_resolve_identity_from_access_key_translates_admin_error():
    with pytest.raises(ValueError, match="Unable to resolve RGW user for access key"):
        RgwAccessKeyRotator().resolve_identity_from_access_key(
            _Admin(error=RGWAdminError("upstream failed")),
            "access",
        )
