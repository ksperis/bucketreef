# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from botocore.exceptions import ClientError

from app.db import S3Account
from app.services.browser_service import BrowserService


_ALL_USERS = "http://acs.amazonaws.com/groups/global/AllUsers"
_AUTHENTICATED_USERS = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers"


def _account() -> S3Account:
    return S3Account(name="object-acl-test")


def _grant(permission: str, **grantee) -> dict[str, object]:
    return {"Permission": permission, "Grantee": grantee}


@pytest.mark.parametrize(
    ("grants", "expected_acl"),
    [
        (
            [_grant("FULL_CONTROL", Type="CanonicalUser", ID="owner-id")],
            "private",
        ),
        (
            [
                _grant("FULL_CONTROL", Type="CanonicalUser", ID="owner-id"),
                _grant("READ", Type="Group", URI=_ALL_USERS),
            ],
            "public-read",
        ),
        (
            [
                _grant("READ", Type="Group", URI=_ALL_USERS),
                _grant("WRITE", Type="Group", URI=_ALL_USERS),
            ],
            "public-read-write",
        ),
        (
            [_grant("READ", Type="Group", URI=_AUTHENTICATED_USERS)],
            "authenticated-read",
        ),
        (
            [_grant("READ", Type="CanonicalUser", ID="other-user")],
            "custom",
        ),
    ],
)
def test_get_object_acl_infers_supported_canned_acl(monkeypatch, grants, expected_acl):
    calls: list[dict[str, object]] = []

    class FakeClient:
        def get_object_acl(self, **kwargs):  # noqa: ANN001
            calls.append(kwargs)
            return {"Owner": {"ID": "owner-id"}, "Grants": grants}

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _context: FakeClient())

    result = service.get_object_acl(
        "bucket-a",
        _account(),
        "docs/report.txt",
        version_id="v1",
    )

    assert result.key == "docs/report.txt"
    assert result.acl == expected_acl
    assert result.version_id == "v1"
    assert calls == [{"Bucket": "bucket-a", "Key": "docs/report.txt", "VersionId": "v1"}]


def test_get_object_acl_ignores_empty_and_owner_only_grants(monkeypatch):
    class FakeClient:
        def get_object_acl(self, **_kwargs):  # noqa: ANN001
            return {
                "Owner": {"ID": "owner-id"},
                "Grants": [
                    _grant("", Type="CanonicalUser", ID="other-user"),
                    _grant("FULL_CONTROL", Type="CanonicalUser", ID="owner-id"),
                ],
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _context: FakeClient())

    assert service.get_object_acl("bucket-a", _account(), "object.txt").acl == "private"


def test_get_object_acl_wraps_storage_errors(monkeypatch):
    class FakeClient:
        def get_object_acl(self, **_kwargs):  # noqa: ANN001
            raise ClientError(
                {"Error": {"Code": "AccessDenied", "Message": "denied"}},
                "GetObjectAcl",
            )

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _context: FakeClient())

    with pytest.raises(RuntimeError, match="Unable to fetch ACL for 'secret.txt'"):
        service.get_object_acl("bucket-a", _account(), "secret.txt")
