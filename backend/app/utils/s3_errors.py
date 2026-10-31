# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Collection

from botocore.exceptions import ClientError

from app.core.sensitive_data import sanitized_error_log_detail
from app.utils.aws_errors import aws_error_code
from app.utils.exception_chain import iter_exception_chain


_ACCESS_DENIED_CODES = frozenset(
    {"403", "access_denied", "accessdenied", "forbidden", "unauthorized"}
)
_FEATURE_UNSUPPORTED_CODES = frozenset(
    {
        "methodnotallowed",
        "notallowed",
        "notimplemented",
        "notsupported",
        "unsupported",
        "unsupportedoperation",
        "xnotimplemented",
    }
)


def matches_s3_error(
    exc: Exception,
    *,
    codes: Collection[str] = (),
    status_codes: Collection[int] = (),
) -> bool:
    normalized_codes = {str(code).strip().lower() for code in codes}
    normalized_statuses = {int(status_code) for status_code in status_codes}
    for current in iter_exception_chain(exc):
        if not isinstance(current, ClientError):
            continue
        client_error = current
        if aws_error_code(client_error, lowercase=True) in normalized_codes:
            return True
        upstream_status = client_error.response.get("ResponseMetadata", {}).get(
            "HTTPStatusCode"
        )
        if upstream_status in normalized_statuses:
            return True
    return False


def is_s3_access_denied(exc: Exception) -> bool:
    return matches_s3_error(
        exc,
        codes=_ACCESS_DENIED_CODES,
        status_codes={401, 403},
    )


def is_s3_feature_unsupported(exc: Exception) -> bool:
    return matches_s3_error(
        exc,
        codes=_FEATURE_UNSUPPORTED_CODES,
        status_codes={501},
    )


def format_s3_error(exc: Exception, *, include_operation: bool = False) -> str:
    if not isinstance(exc, ClientError):
        return sanitized_error_log_detail(exc)
    error = exc.response.get("Error", {}) if hasattr(exc, "response") else {}
    code = aws_error_code(exc)
    message = str(error.get("Message") or "").strip()
    parts = [part for part in (code, message) if part and part.lower() != "none"]
    detail = ": ".join(parts) if parts else sanitized_error_log_detail(exc)
    operation = str(getattr(exc, "operation_name", "") or "").strip()
    if include_operation and operation:
        return sanitized_error_log_detail(f"{operation} failed with {detail}")
    return sanitized_error_log_detail(detail)
