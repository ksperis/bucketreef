# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations
from typing import NoReturn

from botocore.exceptions import (
    ClientError,
    ConnectTimeoutError,
    ConnectionClosedError,
    EndpointConnectionError,
    ReadTimeoutError,
)
from fastapi import HTTPException, status
from requests.exceptions import ConnectionError as RequestsConnectionError
from requests.exceptions import Timeout as RequestsTimeout

from app.core.domain_errors import ResourceConflictError, ResourceNotFoundError
from app.core.sensitive_data import sanitize_error_detail


_CONFLICT_ERROR_CODES = frozenset({"preconditionfailed", "conditionalrequestconflict"})
_FORBIDDEN_ERROR_CODES = frozenset(
    {"accessdenied", "invalidaccesskeyid", "signaturedoesnotmatch"}
)


def _exception_chain(exc: Exception):
    current: BaseException | None = exc
    seen: set[int] = set()
    while isinstance(current, Exception) and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def _client_error_status_code(exc: ClientError) -> int | None:
    response = exc.response or {}
    error = response.get("Error") or {}
    code = str(error.get("Code") or "").lower()
    upstream_status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    if upstream_status in {409, 412} or code in _CONFLICT_ERROR_CODES:
        return status.HTTP_409_CONFLICT
    if upstream_status in {401, 403} or code in _FORBIDDEN_ERROR_CODES:
        return status.HTTP_403_FORBIDDEN
    return None


def _exception_status_code(exc: Exception) -> int | None:
    upstream_status = getattr(exc, "status_code", None)
    if upstream_status in {409, 412}:
        return status.HTTP_409_CONFLICT
    if upstream_status in {401, 403}:
        return status.HTTP_403_FORBIDDEN
    if upstream_status in {408, 504}:
        return status.HTTP_504_GATEWAY_TIMEOUT
    if upstream_status == 503:
        return status.HTTP_503_SERVICE_UNAVAILABLE
    return None


def _structured_upstream_status_code(exc: Exception) -> int | None:
    for current in _exception_chain(exc):
        if isinstance(current, (ConnectTimeoutError, ReadTimeoutError, RequestsTimeout, TimeoutError)):
            return status.HTTP_504_GATEWAY_TIMEOUT
        if isinstance(current, (EndpointConnectionError, ConnectionClosedError, RequestsConnectionError)):
            return status.HTTP_503_SERVICE_UNAVAILABLE
        if isinstance(current, ClientError):
            client_status = _client_error_status_code(current)
            if client_status is not None:
                return client_status
        exception_status = _exception_status_code(current)
        if exception_status is not None:
            return exception_status
    return None


def raise_bad_gateway_from_runtime(exc: RuntimeError) -> NoReturn:
    raise_http_exception_from_exception(_upstream_status_code(exc), exc)


def _has_timeout_message(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(marker in message for marker in ("timed out", "timeout", "read timeout"))


def is_upstream_timeout(exc: Exception) -> bool:
    structured_status = _structured_upstream_status_code(exc)
    if structured_status == status.HTTP_504_GATEWAY_TIMEOUT:
        return True
    return _has_timeout_message(exc)


def _upstream_status_code(exc: Exception) -> int:
    structured_status = _structured_upstream_status_code(exc)
    if structured_status is not None:
        return structured_status
    if _has_timeout_message(exc):
        return status.HTTP_504_GATEWAY_TIMEOUT
    message = str(exc).lower()
    if any(
        marker in message
        for marker in (
            "could not connect",
            "connection refused",
            "failed to establish a new connection",
            "name or service not known",
            "temporary failure in name resolution",
            "connection aborted",
        )
    ):
        return status.HTTP_503_SERVICE_UNAVAILABLE
    if any(marker in message for marker in ("accessdenied", "invalidaccesskeyid", "signaturedoesnotmatch")):
        return status.HTTP_403_FORBIDDEN
    return status.HTTP_502_BAD_GATEWAY


def raise_bad_request_from_value_error(exc: ValueError) -> NoReturn:
    raise_http_exception_from_exception(status.HTTP_400_BAD_REQUEST, exc)


def raise_http_error_from_value_error(exc: ValueError) -> NoReturn:
    if isinstance(exc, ResourceNotFoundError):
        status_code = status.HTTP_404_NOT_FOUND
    elif isinstance(exc, ResourceConflictError):
        status_code = status.HTTP_409_CONFLICT
    else:
        status_code = status.HTTP_400_BAD_REQUEST
    raise_http_exception_from_exception(status_code, exc)


def http_exception_from_exception(status_code: int, exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail=sanitize_error_detail(str(exc)),
    )


def raise_http_exception_from_exception(status_code: int, exc: Exception) -> NoReturn:
    raise http_exception_from_exception(status_code, exc) from exc
