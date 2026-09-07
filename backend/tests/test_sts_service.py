# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime, timezone

import pytest
from botocore.exceptions import ClientError

from app.services import sts_service


@pytest.fixture(autouse=True)
def _fixed_sts_clock(monkeypatch):
    monkeypatch.setattr(sts_service, "utcnow", lambda: datetime(2026, 3, 5, 10, tzinfo=timezone.utc))


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "GetSessionToken")


class _FakeStsClient:
    def __init__(self, *, session_payload=None, error: Exception | None = None):
        self.session_payload = session_payload
        self.error = error

    def get_session_token(self, **kwargs):
        if self.error:
            raise self.error
        return self.session_payload or {}


def test_get_sts_client_requires_endpoint():
    with pytest.raises(RuntimeError, match="STS endpoint is not configured"):
        sts_service.get_sts_client("ak", "sk", endpoint=None)


@pytest.mark.parametrize(
    "expiration",
    [
        datetime(2026, 3, 5, 10, 20, 30, tzinfo=timezone.utc),
        "2026-03-05T12:20:30+02:00",
    ],
)
def test_get_session_token_normalizes_valid_expiration_to_utc(monkeypatch, expiration):
    fake = _FakeStsClient(
        session_payload={
            "Credentials": {
                "AccessKeyId": "STS_AK",
                "SecretAccessKey": "STS_SK",
                "SessionToken": "STS_TOKEN",
                "Expiration": expiration,
            }
        }
    )
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    access, secret, token, exp = sts_service.get_session_token(
        900,
        "AK",
        "SK",
        endpoint="https://sts.example.test",
    )
    assert (access, secret, token) == ("STS_AK", "STS_SK", "STS_TOKEN")
    assert exp == datetime(2026, 3, 5, 10, 20, 30, tzinfo=timezone.utc)


def test_get_session_token_success_and_error_paths(monkeypatch):
    ok_client = _FakeStsClient(
        session_payload={
            "Credentials": {
                "AccessKeyId": "STS_AK",
                "SecretAccessKey": "STS_SK",
                "SessionToken": "STS_TOKEN",
                "Expiration": "2026-03-05T10:20:30+00:00",
            }
        }
    )
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: ok_client)
    access, secret, token, _ = sts_service.get_session_token(
        900,
        "AK",
        "SK",
        endpoint="https://sts.example.test",
    )
    assert (access, secret, token) == ("STS_AK", "STS_SK", "STS_TOKEN")

    bad_client = _FakeStsClient(session_payload={"Credentials": {"AccessKeyId": "only"}})
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: bad_client)
    with pytest.raises(RuntimeError, match="did not return credentials"):
        sts_service.get_session_token(900, "AK", "SK", endpoint="https://sts.example.test")

    err_client = _FakeStsClient(error=_client_error("Throttling"))
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: err_client)
    with pytest.raises(RuntimeError, match="Unable to get session token"):
        sts_service.get_session_token(900, "AK", "SK", endpoint="https://sts.example.test")


@pytest.mark.parametrize(
    "expiration",
    [
        None,
        "",
        "invalid-provider-value",
        123,
        datetime(2026, 3, 5, 10, 20, 30),
        "2026-03-05T10:20:30",
    ],
)
def test_get_session_token_rejects_missing_or_invalid_expiration(monkeypatch, expiration):
    fake = _FakeStsClient(
        session_payload={
            "Credentials": {
                "AccessKeyId": "STS_AK",
                "SecretAccessKey": "STS_SK",
                "SessionToken": "STS_TOKEN",
                "Expiration": expiration,
            },
        },
    )
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    with pytest.raises(RuntimeError, match="STS get session token did not return a valid timezone-aware expiration"):
        sts_service.get_session_token(900, "AK", "SK", endpoint="https://sts.example.test")


@pytest.mark.parametrize("credentials", [None, "invalid-provider-value", ["invalid-provider-value"]])
def test_get_session_token_rejects_invalid_credential_envelopes(monkeypatch, credentials):
    fake = _FakeStsClient(session_payload={"Credentials": credentials})
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    with pytest.raises(RuntimeError, match="STS get session token did not return credentials"):
        sts_service.get_session_token(900, "AK", "SK", endpoint="https://sts.example.test")


@pytest.mark.parametrize("field", ["AccessKeyId", "SecretAccessKey", "SessionToken"])
def test_get_session_token_requires_string_credentials(monkeypatch, field):
    credentials = {
        "AccessKeyId": "STS_AK",
        "SecretAccessKey": "STS_SK",
        "SessionToken": "STS_TOKEN",
        "Expiration": "2026-03-05T10:20:30+00:00",
        field: 123,
    }
    fake = _FakeStsClient(session_payload={"Credentials": credentials})
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    with pytest.raises(RuntimeError, match="STS get session token did not return credentials"):
        sts_service.get_session_token(900, "AK", "SK", endpoint="https://sts.example.test")


@pytest.mark.parametrize("expiration", ["2026-03-05T09:59:59+00:00", "2026-03-05T10:00:00+00:00"])
def test_get_session_token_rejects_already_expired_credentials(monkeypatch, expiration):
    fake = _FakeStsClient(
        session_payload={
            "Credentials": {
                "AccessKeyId": "STS_AK",
                "SecretAccessKey": "STS_SK",
                "SessionToken": "STS_TOKEN",
                "Expiration": expiration,
            },
        },
    )
    monkeypatch.setattr(sts_service, "get_sts_client", lambda *args, **kwargs: fake)

    with pytest.raises(RuntimeError, match="STS get session token returned expired credentials"):
        sts_service.get_session_token(900, "AK", "SK", endpoint="https://sts.example.test")
