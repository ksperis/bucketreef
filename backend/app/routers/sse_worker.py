# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import asyncio
from collections.abc import Callable
import json
import logging
import threading
import uuid
from typing import TypeVar

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.sensitive_data import sanitize_error_detail

SSE_KEEPALIVE_INTERVAL_SECONDS = 10.0
SSE_RESPONSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}
SseMessageSender = Callable[[str], None]
SseWorker = Callable[[SseMessageSender, threading.Event], None]
_ProgressModelT = TypeVar("_ProgressModelT", bound=BaseModel)
_ResultModelT = TypeVar("_ResultModelT", bound=BaseModel)


def format_sse_event(event: str, payload: dict[str, object]) -> str:
    payload_json = json.dumps(
        payload,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )
    lines = [f"event: {event}"]
    lines.extend(f"data: {line}" for line in payload_json.splitlines() or [payload_json])
    lines.append("")
    return "\n".join(lines) + "\n"


def build_sse_progress_callback(
    push_message: SseMessageSender,
    *,
    request_id: str,
) -> Callable[[_ProgressModelT], None]:
    def progress_callback(progress: _ProgressModelT) -> None:
        payload = progress.model_copy(update={"request_id": request_id}).model_dump(mode="json")
        push_message(format_sse_event("progress", payload))

    return progress_callback


def stream_status_operation(
    request: Request,
    *,
    run_operation: Callable[
        [Callable[[_ProgressModelT], None], Callable[[], None]],
        _ResultModelT,
    ],
    cancelled_error: type[Exception],
    logger: logging.Logger,
    operation: str,
    failure_message: str,
    on_start: Callable[[str], None] | None = None,
    on_result: Callable[[str, _ResultModelT], None] | None = None,
    on_cancel: Callable[[str], None] | None = None,
    on_error: Callable[[str, str], None] | None = None,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        progress_callback = build_sse_progress_callback(push_message, request_id=request_id)

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise cancelled_error()

        try:
            if on_start:
                on_start(request_id)
            result = run_operation(progress_callback, cancel_check)
            if on_result:
                on_result(request_id, result)
            result_payload = result.model_dump(mode="json")
            push_message(format_sse_event("result", result_payload))
            push_message(
                format_sse_event(
                    "done",
                    {"request_id": request_id, "status": result_payload["status"]},
                )
            )
        except cancelled_error:
            if on_cancel:
                on_cancel(request_id)
            push_message(
                format_sse_event(
                    "done",
                    {"request_id": request_id, "status": "canceled"},
                )
            )
        except HTTPException as exc:
            detail = sanitize_error_detail(exc.detail)
            if on_error:
                on_error(request_id, str(detail))
            push_message(
                format_sse_event(
                    "error",
                    {
                        "request_id": request_id,
                        "detail": detail,
                        "status_code": exc.status_code,
                    },
                )
            )
            push_message(
                format_sse_event(
                    "done",
                    {"request_id": request_id, "status": "failed"},
                )
            )
        except Exception as exc:  # pragma: no cover
            logger.exception("%s: %s", failure_message, exc)
            if on_error:
                on_error(request_id, failure_message)
            push_message(
                format_sse_event(
                    "error",
                    {"request_id": request_id, "detail": failure_message},
                )
            )
            push_message(
                format_sse_event(
                    "done",
                    {"request_id": request_id, "status": "failed"},
                )
            )

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation=operation,
        request_id=request_id,
    )


async def wait_for_cancellable_worker(
    worker_task: asyncio.Task,
    cancel_event: threading.Event,
    *,
    logger: logging.Logger,
    operation: str,
    request_id: str,
) -> None:
    cancel_event.set()
    try:
        await asyncio.shield(worker_task)
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001
        logger.debug(
            "SSE worker cleanup failed after cancellation",
            extra={"operation": operation, "request_id": request_id},
            exc_info=True,
        )


def stream_cancellable_worker(
    request: Request,
    *,
    worker: SseWorker,
    logger: logging.Logger,
    operation: str,
    request_id: str,
) -> StreamingResponse:
    async def event_generator():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[str | None] = asyncio.Queue()
        cancel_event = threading.Event()

        def push_message(payload: str | None) -> None:
            loop.call_soon_threadsafe(queue.put_nowait, payload)

        def run_worker() -> None:
            try:
                worker(push_message, cancel_event)
            finally:
                push_message(None)

        worker_task = asyncio.create_task(asyncio.to_thread(run_worker))
        try:
            while True:
                if await request.is_disconnected():
                    cancel_event.set()
                    break
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=SSE_KEEPALIVE_INTERVAL_SECONDS)
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        cancel_event.set()
                        break
                    yield ": keepalive\n\n"
                    continue
                if message is None:
                    break
                yield message
        finally:
            await wait_for_cancellable_worker(
                worker_task,
                cancel_event,
                logger=logger,
                operation=operation,
                request_id=request_id,
            )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers=SSE_RESPONSE_HEADERS,
    )
