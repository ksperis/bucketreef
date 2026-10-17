# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Callable, TypeVar

from fastapi import HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from app.core.sensitive_data import sanitize_error_detail
from app.routers.sse_worker import (
    SseMessageSender,
    format_sse_event,
    stream_cancellable_worker,
)
from app.services.listing_progress import ListingCancelled, ListingProgressSnapshot
from app.utils.http_errors import raise_http_exception_from_exception


_ModelT = TypeVar("_ModelT", bound=BaseModel)


def stream_listing_response(
    request: Request,
    *,
    compute: Callable[
        [Callable[[ListingProgressSnapshot], None], Callable[[], None]],
        BaseModel,
    ],
    logger: logging.Logger,
    failure_message: str,
) -> StreamingResponse:
    request_id = uuid.uuid4().hex

    def worker(push_message: SseMessageSender, cancel_event: threading.Event) -> None:
        def progress_callback(snapshot: ListingProgressSnapshot) -> None:
            payload: dict[str, object] = {
                "request_id": request_id,
                "percent": snapshot.percent,
                "stage": snapshot.stage,
                "processed": snapshot.processed,
                "total": snapshot.total,
            }
            if snapshot.message:
                payload["message"] = snapshot.message
            push_message(format_sse_event("progress", payload))

        def cancel_check() -> None:
            if cancel_event.is_set():
                raise ListingCancelled()

        try:
            result = compute(progress_callback, cancel_check)
            payload = result.model_dump(mode="json")
            push_message(format_sse_event("result", payload))
            push_message(format_sse_event("done", {"request_id": request_id}))
        except ListingCancelled:
            return
        except HTTPException as exc:
            push_message(
                format_sse_event(
                    "error",
                    {
                        "request_id": request_id,
                        "detail": sanitize_error_detail(exc.detail),
                    },
                )
            )
            push_message(format_sse_event("done", {"request_id": request_id}))
        except Exception as exc:  # pragma: no cover
            logger.exception("%s: %s", failure_message, exc)
            push_message(
                format_sse_event(
                    "error",
                    {
                        "request_id": request_id,
                        "detail": failure_message,
                    },
                )
            )
            push_message(format_sse_event("done", {"request_id": request_id}))

    return stream_cancellable_worker(
        request,
        worker=worker,
        logger=logger,
        operation="listing_stream",
        request_id=request_id,
    )


def parse_filter_query(
    raw: str | None,
    *,
    query_cls: type[_ModelT],
) -> _ModelT | None:
    if raw is None:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid advanced_filter JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="advanced_filter must be a JSON object")
    try:
        return query_cls.model_validate(parsed)
    except ValidationError as exc:
        raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)
