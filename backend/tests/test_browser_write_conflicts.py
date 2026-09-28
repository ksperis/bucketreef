from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError

from app.models.browser import BrowserWriteGuard, PresignRequest
from app.services.browser.write_conflicts import BrowserWriteConflict, check_destination, observe_destination
from app.services.browser_service import BrowserService
from app.utils.http_errors import _upstream_status_code


def account(provider):
    return SimpleNamespace(storage_endpoint=SimpleNamespace(provider=provider))


def missing():
    return ClientError({"Error": {"Code": "404"}}, "HeadObject")


def test_missing_destination_uses_create_only_condition_on_aws():
    client = Mock(); client.head_object.side_effect = missing()
    assert check_destination(client, account("aws"), "bucket", "a//é.txt", BrowserWriteGuard(exists=False)) == {"IfNoneMatch": "*"}
    client.head_object.assert_called_once_with(Bucket="bucket", Key="a//é.txt")


def test_denied_head_is_not_treated_as_missing():
    client = Mock(); client.head_object.side_effect = ClientError({"Error": {"Code": "AccessDenied"}, "ResponseMetadata": {"HTTPStatusCode": 403}}, "HeadObject")
    with pytest.raises(RuntimeError) as error:
        observe_destination(client, "bucket", "private")
    assert _upstream_status_code(error.value) == 403


@pytest.mark.parametrize("guard", [BrowserWriteGuard(exists=False), BrowserWriteGuard(exists=True, etag='"old"')])
def test_concurrent_destination_change_stops_the_write(guard):
    client = Mock(); client.head_object.return_value = {"ETag": '"new"', "ContentLength": 2}
    with pytest.raises(BrowserWriteConflict) as error:
        check_destination(client, account("ceph"), "bucket", "key", guard)
    assert _upstream_status_code(error.value) == 409


@pytest.mark.parametrize("provider,expected", [("aws", {"IfMatch": '"same"'}), ("ceph", {}), ("other", {})])
def test_provider_guarantee_is_explicit(provider, expected):
    client = Mock(); client.head_object.return_value = {"ETag": '"same"'}
    assert check_destination(client, account(provider), "bucket", "key", BrowserWriteGuard(exists=True, etag='"same"')) == expected


def test_presigned_upload_signs_and_returns_the_condition(monkeypatch):
    client = Mock(); client.head_object.side_effect = missing(); client.generate_presigned_url.return_value = "https://example.test/object"
    service = BrowserService(); monkeypatch.setattr(service, "_client", lambda *_args: client)
    result = service.presign("bucket", account("aws"), PresignRequest(key="key", operation="put_object", write_guard=BrowserWriteGuard(exists=False)))
    assert result.headers["If-None-Match"] == "*"
    assert client.generate_presigned_url.call_args.kwargs["Params"]["IfNoneMatch"] == "*"


@pytest.mark.parametrize("code", [409, 412])
def test_upstream_conditions_are_exposed_as_conflicts(code):
    error = ClientError({"Error": {"Code": "PreconditionFailed"}, "ResponseMetadata": {"HTTPStatusCode": code}}, "PutObject")
    assert _upstream_status_code(error) == 409
