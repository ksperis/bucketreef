# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Callable, TypeVar

from fastapi import HTTPException, Response, status

from app.core.domain_errors import BucketConfigValidationError
from app.services.s3_deletion import BucketNotEmptyError
from app.utils.http_errors import raise_bad_gateway_from_runtime, raise_bad_request_from_value_error

_T = TypeVar("_T")


def run_bucket_config_action(action: Callable[..., _T], /, **kwargs: Any) -> _T:
    try:
        return action(**kwargs)
    except BucketConfigValidationError as exc:
        raise_bad_request_from_value_error(exc)
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)


def run_bucket_config_no_content(action: Callable[..., Any], /, **kwargs: Any) -> Response:
    run_bucket_config_action(action, **kwargs)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def run_bucket_delete_action(action: Callable[..., None], /, *, bucket_name: str, **kwargs: Any) -> None:
    try:
        action(bucket_name=bucket_name, **kwargs)
    except BucketNotEmptyError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "bucket_not_empty",
                "message": f"Bucket '{bucket_name}' is not empty. Empty it before deleting.",
            },
        ) from exc
    except RuntimeError as exc:
        raise_bad_gateway_from_runtime(exc)
