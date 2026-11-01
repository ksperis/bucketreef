# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import base64
import hashlib
import json
from datetime import datetime, timezone
from typing import Optional

from botocore.exceptions import ClientError

from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.aws_errors import aws_error_code
from app.utils.s3_endpoint import resolve_s3_client_options
OBJECT_LIST_SCAN_PAGE_BUDGET = 20
OBJECT_LIST_SCAN_TIME_BUDGET_MS = 1200
OBJECT_LOCK_UNAVAILABLE_CODES = {
    "nosuchobjectlockconfiguration",
    "objectlockconfigurationnotfounderror",
    "invalidrequest",
}


def _is_object_lock_unavailable(exc: ClientError) -> bool:
    return aws_error_code(exc, lowercase=True) in OBJECT_LOCK_UNAVAILABLE_CODES


def _resolve_endpoint(context: S3ExecutionTarget) -> str:
    endpoint, _, _, _ = resolve_s3_client_options(context)
    if not endpoint:
        raise RuntimeError("S3 endpoint is not configured for this context")
    return endpoint


def _normalize_expiration(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _sorted_snapshot_signature(parts: tuple[object, ...]) -> str:
    serialized = json.dumps(parts, separators=(",", ":"), default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _encode_sorted_cursor(*, prefixes_offset: int, objects_offset: int, signature: str) -> str:
    payload = {
        "v": 1,
        "mode": "sorted",
        "po": max(0, int(prefixes_offset)),
        "oo": max(0, int(objects_offset)),
        "sig": signature,
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    return encoded.rstrip("=")


def _decode_sorted_cursor(token: Optional[str]) -> Optional[dict[str, object]]:
    if not token:
        return None
    padded = token + "=" * (-len(token) % 4)
    try:
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        payload = json.loads(decoded.decode("utf-8"))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("mode") != "sorted" or payload.get("v") != 1:
        return None
    return payload
