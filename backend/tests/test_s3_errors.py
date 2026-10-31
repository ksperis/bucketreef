# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from botocore.exceptions import ClientError

from app.utils.s3_errors import (
    format_s3_error,
    is_s3_access_denied,
    is_s3_feature_unsupported,
)


def _client_error(
    code,
    message,
    operation: str = "ListObjectsV2",
    *,
    status_code: int | None = None,
) -> ClientError:
    response = {"Error": {"Code": code, "Message": message}}
    if status_code is not None:
        response["ResponseMetadata"] = {"HTTPStatusCode": status_code}
    return ClientError(response, operation)


def _wrapped(error: Exception, message: str = "S3 request failed") -> RuntimeError:
    wrapped = RuntimeError(message)
    wrapped.__cause__ = error
    return wrapped


def test_format_s3_error_preserves_operation_as_an_explicit_option():
    error = _client_error("AccessDenied", "denied")

    assert format_s3_error(error) == "AccessDenied: denied"
    assert format_s3_error(error, include_operation=True) == "ListObjectsV2 failed with AccessDenied: denied"


def test_format_s3_error_falls_back_to_plain_exception_text():
    assert format_s3_error(RuntimeError("storage unavailable"), include_operation=True) == "storage unavailable"


def test_access_denied_classification_uses_structured_error_chain():
    denied = _client_error(
        "AccessDenied",
        "denied",
        status_code=403,
    )

    assert is_s3_access_denied(denied) is True
    assert is_s3_access_denied(_wrapped(denied)) is True
    assert is_s3_access_denied(RuntimeError("AccessDenied 403")) is False


def test_unsupported_classification_uses_structured_error_chain():
    method_not_allowed = _client_error(
        "MethodNotAllowed",
        "unsupported",
        "GetBucketWebsite",
        status_code=405,
    )
    not_implemented = _client_error(
        "XNotImplemented",
        "unsupported",
        "GetBucketLogging",
        status_code=501,
    )

    assert is_s3_feature_unsupported(method_not_allowed) is True
    assert is_s3_feature_unsupported(_wrapped(method_not_allowed)) is True
    assert is_s3_feature_unsupported(not_implemented) is True
    assert is_s3_feature_unsupported(RuntimeError("MethodNotAllowed 405")) is False


def test_unsupported_classification_does_not_treat_generic_405_as_feature_signal():
    generic_405 = _client_error(
        "BadRequest",
        "method not allowed",
        "GetBucketWebsite",
        status_code=405,
    )

    assert is_s3_feature_unsupported(generic_405) is False
