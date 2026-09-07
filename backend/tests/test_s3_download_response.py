# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
import anyio
from botocore.response import StreamingBody
from starlette.requests import ClientDisconnect

from app.db import PortalPublicLink, PortalStorageSpaceMetadata, User
from app.models.access_context import AccountAccess
from app.models.account_capabilities import AccountCapabilities
from app.routers import browser_transfers, portal_objects, portal_sharing
from app.routers.s3_download_response import S3DownloadResponse
from app.services.browser_service import BrowserService
from app.services.portal import public_links
from app.services.portal_service import PortalService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.s3_object_download import S3ObjectDownload
from tests.s3_account_factory import make_s3_account


class TrackedStream(BytesIO):
    def __init__(self, data=b"download bytes", *, fail_read=False):
        super().__init__(data)
        self.fail_read = fail_read
        self.close_count = 0
        self.read_sizes = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        if self.fail_read:
            raise RuntimeError("provider read failed")
        return super().read(size)

    def close(self):
        self.close_count += 1
        super().close()


@pytest.fixture(params=["browser", "portal", "public_link"])
def response_factory(request, monkeypatch, db_session):
    def make_response(raw):
        body = StreamingBody(raw, len(raw.getvalue()))
        client = SimpleNamespace(get_object=lambda **_kwargs: {"Body": body, "ContentType": "text/plain"})
        if request.param == "browser":
            service = BrowserService()
            monkeypatch.setattr(service, "_client", lambda *_args, **_kwargs: client)
            account = S3ExecutionContext(
                context_id="conn-42", context_kind="connection", name="Download",
                access_key="TEST-AK", secret_key="TEST-SK",
            )
            return browser_transfers.download_object(
                "bucket", "folder/file.txt", account=account, service=service, sse_customer=None,
            )

        account = make_s3_account(db_session, name="portal-download", rgw_access_key="TEST-AK", rgw_secret_key="TEST-SK")
        user = User(email="download@example.test", hashed_password="x", role="ui_user")
        db_session.add_all([account, user])
        db_session.flush()
        db_session.add(PortalStorageSpaceMetadata(account_id=account.id, bucket_name="bucket", visibility="shared"))
        db_session.flush()
        service = PortalService(db_session)
        if request.param == "portal":
            # Isolate provider-body lifetime; access checks have dedicated service coverage.
            monkeypatch.setattr(service, "_resolve_storage_space_bucket_name", lambda *_args: "bucket")
            monkeypatch.setattr(service, "_require_storage_space_content_role", lambda *_args: "Editor")
            monkeypatch.setattr(service, "_portal_object_client", lambda *_args, **_kwargs: client)
            access = AccountAccess(
                account=account, actor=user, membership=None, portal_role="portal_user",
                capabilities=AccountCapabilities(),
            )
            return portal_objects.portal_download_storage_space_object(
                "space", key="folder/file.txt", access=access, service=service,
            )

        db_session.add(PortalPublicLink(
            token="public-download", account_id=account.id, bucket_name="bucket", object_key="folder/file.txt",
        ))
        db_session.flush()
        monkeypatch.setattr(public_links, "get_s3_client", lambda *_args, **_kwargs: client)
        return portal_sharing.download_portal_public_link("public-download", service=service)

    return make_response


@pytest.mark.parametrize("outcome", ["complete", "read_error", "send_error", "start_error"])
def test_download_closes_provider_body(response_factory, outcome):
    raw = TrackedStream(fail_read=outcome == "read_error")
    response = response_factory(raw)
    messages = []

    async def send(message):
        if outcome == "send_error" and message["type"] == "http.response.body":
            raise OSError("client disconnected")
        if outcome == "start_error":
            raise OSError("client disconnected before headers")
        messages.append(message)

    async def receive():
        raise AssertionError("ASGI 2.4 detects disconnects through send failures")

    async def run():
        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)

    try:
        if outcome == "complete":
            asyncio.run(run())
            assert b"".join(message.get("body", b"") for message in messages) == b"download bytes"
        else:
            with pytest.raises(RuntimeError if outcome == "read_error" else ClientDisconnect):
                asyncio.run(run())
        assert raw.closed
        assert raw.close_count == 1
        if outcome == "start_error":
            assert raw.read_sizes == []
    finally:
        if not raw.closed:
            raw.close()


@pytest.mark.parametrize("after_first_chunk", [False, True])
def test_disconnect_message_closes_provider_body(response_factory, after_first_chunk):
    raw = TrackedStream(b"x" * (2 * 1024 * 1024))
    response = response_factory(raw)

    async def run():
        first_chunk = asyncio.Event()

        async def send(message):
            if message["type"] == "http.response.body":
                first_chunk.set()
            if not after_first_chunk or first_chunk.is_set():
                await asyncio.Event().wait()

        async def receive():
            if after_first_chunk:
                await first_chunk.wait()
            return {"type": "http.disconnect"}

        await asyncio.wait_for(response({"type": "http", "asgi": {"spec_version": "2.0"}}, receive, send), 2)

    asyncio.run(run())
    assert raw.closed
    assert raw.close_count == 1
    assert len(raw.read_sizes) == (1 if after_first_chunk else 0)


def test_cancellation_does_not_cancel_body_cleanup(response_factory):
    raw = TrackedStream()
    response = response_factory(raw)

    async def run():
        with anyio.CancelScope() as cancel_scope:
            async def send(message):
                cancel_scope.cancel()
                await anyio.sleep_forever()

            async def receive():
                await anyio.sleep_forever()

            await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)

    anyio.run(run)
    assert raw.closed
    assert raw.close_count == 1
    assert raw.read_sizes == []


@pytest.mark.parametrize("size", [0, 3, 3 * 1024 * 1024 + 7])
def test_shared_response_streams_bounded_chunks_and_preserves_headers(size):
    raw = TrackedStream(b"x" * size)
    response = S3DownloadResponse(S3ObjectDownload(StreamingBody(raw, size), None, 'résumé "2026".bin'))
    assert raw.read_sizes == []
    assert response.headers["content-type"] == "application/octet-stream"
    assert "filename*=UTF-8''r%C3%A9sum%C3%A9%20%222026%22.bin" in response.headers["content-disposition"]
    chunks = []

    async def run():
        async def send(message):
            if message["type"] == "http.response.body":
                chunks.append(message["body"])

        async def receive():
            raise AssertionError("Unexpected receive")

        await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)

    asyncio.run(run())
    assert b"".join(chunks) == b"x" * size
    assert max(map(len, chunks)) <= 1024 * 1024
    assert set(raw.read_sizes) == {1024 * 1024}
    assert raw.closed
    assert raw.close_count == 1


def test_invalid_response_headers_close_body_before_streaming():
    raw = TrackedStream()
    download = S3ObjectDownload(StreamingBody(raw, len(raw.getvalue())), "invalid-☃-type", "file.txt")

    with pytest.raises(UnicodeEncodeError):
        S3DownloadResponse(download)

    assert raw.closed
    assert raw.close_count == 1
    assert raw.read_sizes == []
