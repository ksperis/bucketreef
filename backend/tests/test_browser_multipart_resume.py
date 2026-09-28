from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException, UploadFile

from app.main import app
from app.routers import dependencies
from app.services.browser_service import BrowserService, get_browser_service
from app.services.browser.multipart_resume import list_parts, require_multipart_write_access, upload_part
from app.routers.dependencies_internal.portal_access import _is_portal_browser_basic_route_allowed
from starlette.requests import Request


def test_list_parts_preserves_exact_identity_marker_and_encryption():
    sdk = Mock()
    sdk.list_parts.return_value = {"Parts": [{"PartNumber": 1001, "ETag": '"etag"', "Size": 8}], "IsTruncated": True, "NextPartNumberMarker": 1001}
    result = list_parts(sdk, "bucket", " /é// ", " id+%2F ", marker=1000, limit=25, sse={"SSECustomerKey": "runtime-only"})
    assert result == {"parts": [{"part_number": 1001, "etag": '"etag"', "size": 8}], "is_truncated": True, "next_part_number_marker": 1001}
    sdk.list_parts.assert_called_once_with(Bucket="bucket", Key=" /é// ", UploadId=" id+%2F ", PartNumberMarker=1000, MaxParts=25, SSECustomerKey="runtime-only")


def test_missing_upload_is_not_recreated():
    sdk = Mock(); sdk.list_parts.side_effect = ClientError({"Error": {"Code": "NoSuchUpload"}}, "ListParts")
    with pytest.raises(HTTPException) as exc:
        list_parts(sdk, "bucket", "key", "missing")
    assert exc.value.status_code == 404
    sdk.create_multipart_upload.assert_not_called()


def test_proxy_part_passes_spooled_stream_and_bounded_size():
    sdk = Mock(); sdk.upload_part.return_value = {"ETag": "part"}
    file = UploadFile(BytesIO(b"test"), size=4)
    assert upload_part(sdk, "bucket", " /key ", "upload", 2, file) == {"part_number": 2, "etag": "part", "size": 4}
    sdk.upload_part.assert_called_once_with(Bucket="bucket", Key=" /key ", UploadId="upload", PartNumber=2, Body=file.file, ContentLength=4)
    file.size = 5 * 1024 ** 3 + 1
    with pytest.raises(HTTPException) as exc:
        upload_part(sdk, "bucket", "key", "upload", 2, file)
    assert exc.value.status_code == 413
    assert sdk.upload_part.call_count == 1


@pytest.mark.parametrize("role", ["Viewer", None])
def test_resume_rechecks_current_portal_write_grant(role):
    account = SimpleNamespace(portal_storage_spaces=[] if role is None else [SimpleNamespace(internal_bucket_name="bucket", id="space", role=role)])
    with pytest.raises(HTTPException) as exc:
        require_multipart_write_access(account, "bucket")
    assert exc.value.status_code == 403


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_portal_route_allowlist_includes_only_exact_parts_route(method):
    for suffix, expected in [("/parts", True), ("/parts/extra", False), ("/unknown", False)]:
        request = Request({"type": "http", "method": method, "path": "/api/browser/buckets/bucket/multipart/upload" + suffix, "headers": [], "scheme": "http", "server": ("test", 80)})
        assert _is_portal_browser_basic_route_allowed(request) is expected


def test_http_part_routes_validate_before_s3_and_expose_receipts(client, monkeypatch):
    account = SimpleNamespace(id=42)
    sdk = Mock(); sdk.upload_part.return_value = {"ETag": "part"}
    sdk.list_parts.return_value = {"Parts": [], "IsTruncated": False}
    service = BrowserService(); monkeypatch.setattr(service, "_client", lambda *_a, **_kw: sdk)
    app.dependency_overrides[dependencies.get_account_context] = lambda: account
    app.dependency_overrides[get_browser_service] = lambda: service
    url = "/api/browser/buckets/bucket/multipart/upload/parts"
    response = client.post(url, data={"key": " /key ", "part_number": "2"}, files={"file": ("part", b"bytes")})
    assert response.status_code == 200, response.text
    assert response.json() == {"part_number": 2, "etag": "part", "size": 5}
    assert client.get(url, params={"key": " /key ", "part_number_marker": 3}).status_code == 200
    assert client.get(url, params={"key": "a", "max_parts": 1001}).status_code == 422
    assert client.post(url, data={"key": "a", "part_number": 0}, files={"file": ("part", b"bytes")}).status_code == 422
    assert sdk.upload_part.call_count == 1
