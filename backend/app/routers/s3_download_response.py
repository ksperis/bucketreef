# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import anyio
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.types import Receive, Scope, Send

from app.services.s3_object_download import S3ObjectDownload
from app.utils.http_headers import build_attachment_content_disposition


class S3DownloadResponse(StreamingResponse):
    """Stream provider bytes and release the body on every response exit."""

    def __init__(self, download: S3ObjectDownload) -> None:
        self._provider_body = download.body
        try:
            super().__init__(
                download.body.iter_chunks(chunk_size=1024 * 1024),
                media_type=download.content_type or "application/octet-stream",
                headers={"Content-Disposition": build_attachment_content_disposition(download.filename)},
            )
        except BaseException:
            download.body.close()
            raise

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Disconnect cancellation must not cancel cleanup or block the event loop.
            with anyio.CancelScope(shield=True):
                await run_in_threadpool(self._provider_body.close)
