# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from io import BytesIO
from types import SimpleNamespace

import pytest
from botocore.exceptions import BotoCoreError, ClientError
from botocore.response import StreamingBody

from app.services.portal.objects import PortalObjectsMixin
from app.services.portal.server_access_log_queries import PortalServerAccessLogQueriesMixin


class TrackedStream(BytesIO):
    def __init__(self, payload, *, failure=None):
        super().__init__(payload)
        self.failure = failure
        self.close_count = 0
        self.read_sizes = []
        self.bytes_read = 0

    def read(self, size=-1):
        self.read_sizes.append(size)
        if self.failure is not None:
            raise self.failure
        result = super().read(size)
        self.bytes_read += len(result)
        return result

    def close(self):
        self.close_count += 1
        super().close()


@pytest.fixture
def tracked_body():
    streams = []

    def create(payload, *, failure=None):
        raw = TrackedStream(payload, failure=failure)
        streams.append(raw)
        return StreamingBody(raw, len(payload)), raw

    yield create
    for raw in streams:
        if not raw.closed:
            raw.close()


def _read_preview(client):
    return PortalObjectsMixin()._safe_content_preview(client, "space", "file.txt", "text/plain")


def _read_log(client):
    return PortalServerAccessLogQueriesMixin()._read_portal_server_access_log_object(client, "logs", "access.log")


@pytest.mark.parametrize(
    "payload",
    [b"", b"hello", b"x" * 65536, b"x" * 70000, b"x" * 65535 + "€".encode(), b"\xff"],
    ids=["empty", "short", "limit", "oversized", "split-utf8", "invalid-utf8"],
)
def test_preview_bounds_actual_read_and_closes_body(tracked_body, payload):
    body, raw = tracked_body(payload)
    calls = []

    def get_object(**kwargs):
        calls.append(kwargs)
        # Deliberately return the entire body, as if the provider ignored Range.
        return {"Body": body}

    result = _read_preview(SimpleNamespace(get_object=get_object))

    assert result == ("text", payload[:65536].decode("utf-8", errors="replace"), None)
    assert calls == [{"Bucket": "space", "Key": "file.txt", "Range": "bytes=0-65535"}]
    assert raw.read_sizes == [65536]
    assert raw.bytes_read == min(len(payload), 65536)
    assert raw.closed
    assert raw.close_count == 1


@pytest.mark.parametrize("payload", [b"", b"log entry\n", b"x" * 70000 + b"\xff"], ids=["empty", "short", "large"])
def test_log_read_preserves_all_bytes_and_closes_body(tracked_body, payload):
    body, raw = tracked_body(payload)
    calls = []

    def get_object(**kwargs):
        calls.append(kwargs)
        return {"Body": body}

    assert _read_log(SimpleNamespace(get_object=get_object)) == payload
    assert calls == [{"Bucket": "logs", "Key": "access.log"}]
    assert raw.bytes_read == len(payload)
    assert raw.closed
    assert raw.close_count == 1


@pytest.mark.parametrize("reader", ["preview", "log"])
@pytest.mark.parametrize("failure_stage", ["request", "read"])
@pytest.mark.parametrize("error_type", ["sdk", "denied"])
def test_provider_errors_keep_reader_semantics_and_close_received_bodies(tracked_body, reader, failure_stage, error_type):
    failure = (
        BotoCoreError()
        if error_type == "sdk"
        else ClientError({"Error": {"Code": "AccessDenied"}}, "GetObject")
    )
    raw = None

    def get_object(**_kwargs):
        nonlocal raw
        if failure_stage == "request":
            raise failure
        body, raw = tracked_body(b"payload", failure=failure)
        return {"Body": body}

    client = SimpleNamespace(get_object=get_object)
    if reader == "preview":
        assert _read_preview(client) == ("unavailable", None, "Preview could not be loaded.")
    else:
        with pytest.raises(RuntimeError, match="Unable to read Portal Server Access Logging object") as caught:
            _read_log(client)
        assert caught.value.__cause__ is failure
    if failure_stage == "read":
        assert raw.closed
        assert raw.close_count == 1


@pytest.mark.parametrize("reader", ["preview", "log"])
@pytest.mark.parametrize("response", [{}, {"Body": None}])
def test_missing_response_body_is_not_a_successful_empty_object(reader, response):
    client = SimpleNamespace(get_object=lambda **_kwargs: response)
    if reader == "preview":
        kind, text, reason = _read_preview(client)
        assert kind == "unavailable"
        assert text is None
        assert reason
    else:
        with pytest.raises(RuntimeError, match="missing response body"):
            _read_log(client)


@pytest.mark.parametrize("reader", [_read_preview, _read_log])
def test_unexpected_read_failure_still_closes_body(tracked_body, reader):
    failure = ValueError("unusable stream")
    body, raw = tracked_body(b"payload", failure=failure)
    client = SimpleNamespace(get_object=lambda **_kwargs: {"Body": body})

    with pytest.raises(ValueError, match="unusable stream"):
        reader(client)

    assert raw.closed
    assert raw.close_count == 1


@pytest.mark.parametrize("code", ["NoSuchKey", "404", "NotFound"])
def test_log_disappearing_between_listing_and_read_is_still_ignored(code):
    def get_object(**_kwargs):
        raise ClientError({"Error": {"Code": code}}, "GetObject")

    assert _read_log(SimpleNamespace(get_object=get_object)) == b""


@pytest.mark.parametrize("content_type, kind", [("image/png", "image"), ("application/pdf", "unavailable")])
def test_nontext_preview_does_not_open_a_provider_body(content_type, kind):
    def get_object(**_kwargs):
        pytest.fail("Non-text previews must not download content")

    result = PortalObjectsMixin()._safe_content_preview(
        SimpleNamespace(get_object=get_object), "space", "file", content_type,
    )
    assert result[0] == kind
    assert result[1] is None
