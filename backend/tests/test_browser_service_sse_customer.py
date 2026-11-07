# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import hashlib
from io import BytesIO

import pytest
from botocore.exceptions import ClientError
from botocore.response import StreamingBody
from pydantic import ValidationError

from app.core.domain_errors import BrowserObjectValidationError
from app.db import S3Account, StorageEndpoint
from app.models.browser import (
    CompleteMultipartUploadRequest,
    MultipartUploadInitRequest,
    ObjectTag,
    PresignPartRequest,
    PresignRequest,
    SseCustomerContext,
)
from app.services.browser_service import BrowserService
from app.services.s3_client import S3OperationError


def _account() -> S3Account:
    account = S3Account(name="browser-sse-c")
    account.id = 17
    account.rgw_access_key = "access-key"
    account.rgw_secret_key = "secret-key"
    account.storage_endpoint = StorageEndpoint(name="browser-sse-c", endpoint_url="https://s3.example.test")
    return account


def _sse_context() -> SseCustomerContext:
    raw_key = bytes(range(32))
    return SseCustomerContext(
        algorithm="AES256",
        key=base64.b64encode(raw_key).decode("ascii"),
        key_md5=base64.b64encode(hashlib.md5(raw_key).digest()).decode("ascii"),
    )


def _client_error(operation: str) -> ClientError:
    return ClientError(
        {"Error": {"Code": "AccessDenied", "Message": "denied"}},
        operation,
    )


def test_presign_includes_sse_customer_params_and_response_headers(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def generate_presigned_url(self, operation_name, Params=None, ExpiresIn=None):  # noqa: N803, ANN001
            captured["operation_name"] = operation_name
            captured["params"] = Params
            captured["expires"] = ExpiresIn
            return "https://example.test/presigned"

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account, request_profile="interactive": FakeClient())

    result = service.presign(
        "bucket-a",
        _account(),
        PresignRequest(key="docs/report.pdf", operation="get_object", expires_in=300),
        sse_customer=_sse_context(),
    )

    assert captured["operation_name"] == "get_object"
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in params
    assert "SSECustomerKeyMD5" in params
    assert result.method == "GET"
    assert result.headers["x-amz-server-side-encryption-customer-algorithm"] == "AES256"
    assert "x-amz-server-side-encryption-customer-key" in result.headers
    assert "x-amz-server-side-encryption-customer-key-MD5" in result.headers


def test_presign_request_rejects_removed_post_object_operation():
    with pytest.raises(ValidationError):
        PresignRequest.model_validate(
            {
                "key": "demo.txt",
                "operation": "post_object",
                "expires_in": 300,
            }
        )


def test_initiate_multipart_upload_passes_sse_customer(monkeypatch):
    captured: dict[str, object] = {}
    profiles: list[str] = []

    class FakeClient:
        def create_multipart_upload(self, **kwargs):  # noqa: ANN001
            captured["kwargs"] = kwargs
            return {"UploadId": "upload-1"}

    service = BrowserService()
    monkeypatch.setattr(
        service,
        "_client",
        lambda _account, request_profile="interactive": profiles.append(request_profile) or FakeClient(),
    )

    response = service.initiate_multipart_upload(
        "bucket-a",
        _account(),
        MultipartUploadInitRequest(key="large.bin"),
        sse_customer=_sse_context(),
    )

    assert response.upload_id == "upload-1"
    assert profiles == ["long_running"]
    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in kwargs
    assert "SSECustomerKeyMD5" in kwargs


def test_initiate_multipart_upload_preserves_literal_tag_pairs(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def create_multipart_upload(self, **kwargs):  # noqa: ANN001
            captured["kwargs"] = kwargs
            return {"UploadId": "upload-1"}

    service = BrowserService()
    monkeypatch.setattr(
        service,
        "_client",
        lambda _account, request_profile="interactive": FakeClient(),
    )

    service.initiate_multipart_upload(
        "bucket-a",
        _account(),
        MultipartUploadInitRequest(
            key="archive.bin",
            tags=[
                ObjectTag(key=" tag ", value=" value "),
                ObjectTag(key=" ", value="literal-space-key"),
            ],
        ),
    )

    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["Tagging"] == "+tag+=+value+&+=literal-space-key"


def test_multipart_provider_failures_are_typed(monkeypatch):
    class FakeClient:
        def create_multipart_upload(self, **_kwargs):  # noqa: ANN001
            raise _client_error("CreateMultipartUpload")

        def list_multipart_uploads(self, **_kwargs):  # noqa: ANN001
            raise _client_error("ListMultipartUploads")

        def generate_presigned_url(self, *_args, **_kwargs):  # noqa: ANN002, ANN003
            raise _client_error("UploadPart")

    service = BrowserService()
    monkeypatch.setattr(
        service,
        "_client",
        lambda *_args, **_kwargs: FakeClient(),
    )

    with pytest.raises(S3OperationError, match="Unable to initiate multipart upload"):
        service.initiate_multipart_upload(
            "bucket-a",
            _account(),
            MultipartUploadInitRequest(key="large.bin"),
        )
    with pytest.raises(S3OperationError, match="Unable to list multipart uploads"):
        service.list_multipart_uploads("bucket-a", _account())
    with pytest.raises(S3OperationError, match="Unable to presign part 3"):
        service.presign_part(
            "bucket-a",
            _account(),
            PresignPartRequest(key="large.bin", upload_id="upload-1", part_number=3),
        )


def test_multipart_validation_failures_are_typed():
    service = BrowserService()

    with pytest.raises(BrowserObjectValidationError, match="Upload id is required"):
        service.presign_part(
            "bucket-a",
            _account(),
            PresignPartRequest(key="large.bin", part_number=1),
        )
    with pytest.raises(BrowserObjectValidationError, match="No parts provided"):
        service.complete_multipart_upload(
            "bucket-a",
            _account(),
            "large.bin",
            "upload-1",
            CompleteMultipartUploadRequest(parts=[]),
        )


def test_multipart_missing_upload_id_response_is_s3_failure(monkeypatch):
    class FakeClient:
        def create_multipart_upload(self, **_kwargs):  # noqa: ANN001
            return {}

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda *_args, **_kwargs: FakeClient())

    with pytest.raises(S3OperationError, match="failed to return an upload id"):
        service.initiate_multipart_upload(
            "bucket-a",
            _account(),
            MultipartUploadInitRequest(key="large.bin"),
        )


def test_presign_part_passes_sse_customer_and_returns_required_headers(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def generate_presigned_url(self, operation_name, Params=None, ExpiresIn=None):  # noqa: N803, ANN001
            captured["operation_name"] = operation_name
            captured["params"] = Params
            captured["expires"] = ExpiresIn
            return "https://example.test/upload-part"

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    result = service.presign_part(
        "bucket-a",
        _account(),
        PresignPartRequest(key="large.bin", upload_id="upload-1", part_number=3, expires_in=900),
        sse_customer=_sse_context(),
    )

    assert captured["operation_name"] == "upload_part"
    params = captured["params"]
    assert isinstance(params, dict)
    assert params["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in params
    assert "SSECustomerKeyMD5" in params
    assert result.headers["x-amz-server-side-encryption-customer-algorithm"] == "AES256"
    assert "x-amz-server-side-encryption-customer-key" in result.headers
    assert "x-amz-server-side-encryption-customer-key-MD5" in result.headers


def test_head_object_passes_sse_customer_headers(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def head_object(self, **kwargs):  # noqa: ANN001
            captured["kwargs"] = kwargs
            return {
                "ContentLength": 1,
                "ETag": '"abc"',
                "LastModified": None,
                "ContentType": "text/plain",
                "Metadata": {},
            }

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account: FakeClient())

    service.head_object("bucket-a", _account(), "docs/report.txt", sse_customer=_sse_context())

    kwargs = captured["kwargs"]
    assert isinstance(kwargs, dict)
    assert kwargs["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in kwargs
    assert "SSECustomerKeyMD5" in kwargs


def test_download_object_passes_sse_customer(monkeypatch):
    calls: list[dict[str, object]] = []
    profiles: list[str] = []

    class FakeClient:
        def get_object(self, **kwargs):  # noqa: ANN001
            calls.append(kwargs)
            return {
                "Body": StreamingBody(BytesIO(b"hello"), 5),
                "ContentType": "text/plain",
                "ContentDisposition": 'attachment; filename="demo.txt"',
            }

    service = BrowserService()
    monkeypatch.setattr(
        service,
        "_client",
        lambda _account, request_profile="interactive": (
            profiles.append(request_profile) or FakeClient()
        ),
    )

    download = service.download_object(
        "bucket-a",
        _account(),
        "docs/demo.txt",
        sse_customer=_sse_context(),
    )

    assert download.content_type == "text/plain"
    assert download.filename == "demo.txt"
    assert download.body.read() == b"hello"
    download.body.close()
    assert len(calls) == 1
    assert profiles == ["long_running"]
    for kwargs in calls:
        assert kwargs["SSECustomerAlgorithm"] == "AES256"
        assert "SSECustomerKey" in kwargs
        assert "SSECustomerKeyMD5" in kwargs


def test_proxy_upload_passes_sse_customer(monkeypatch):
    captured: dict[str, object] = {}

    class FakeClient:
        def upload_fileobj(self, file_obj, bucket_name, key, ExtraArgs=None):  # noqa: N803, ANN001
            file_obj.read(1)
            captured["bucket_name"] = bucket_name
            captured["key"] = key
            captured["extra_args"] = ExtraArgs or {}

    service = BrowserService()
    monkeypatch.setattr(service, "_client", lambda _account, request_profile="interactive": FakeClient())

    service.proxy_upload(
        "bucket-a",
        _account(),
        "docs/upload.bin",
        BytesIO(b"content"),
        "application/octet-stream",
        sse_customer=_sse_context(),
    )

    assert captured["bucket_name"] == "bucket-a"
    assert captured["key"] == "docs/upload.bin"
    extra_args = captured["extra_args"]
    assert extra_args["ContentType"] == "application/octet-stream"
    assert extra_args["SSECustomerAlgorithm"] == "AES256"
    assert "SSECustomerKey" in extra_args
    assert "SSECustomerKeyMD5" in extra_args


def test_upload_via_proxy_falls_back_to_upload_file_content_type(monkeypatch):
    captured: dict[str, object] = {}

    class FakeUpload:
        file = BytesIO(b"content")
        content_type = "text/plain"

    service = BrowserService()

    def capture_proxy_upload(
        bucket_name,
        account,
        key,
        file_obj,
        content_type,
        sse_customer=None,
    ):  # noqa: ANN001
        captured.update(
            {
                "bucket_name": bucket_name,
                "account": account,
                "key": key,
                "file_obj": file_obj,
                "content_type": content_type,
                "sse_customer": sse_customer,
            }
        )

    monkeypatch.setattr(service, "proxy_upload", capture_proxy_upload)

    upload = FakeUpload()
    service.upload_via_proxy(
        "bucket-a",
        _account(),
        upload,
        key="docs/report.txt",
        content_type=None,
    )

    assert captured["bucket_name"] == "bucket-a"
    assert captured["key"] == "docs/report.txt"
    assert captured["file_obj"] is upload.file
    assert captured["content_type"] == "text/plain"
