# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from app.services.s3_bucket_config_delete import delete_bucket_configuration


def _client_error(code: str) -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": "provider error"}},
        "DeleteBucketConfiguration",
    )


def test_delete_bucket_configuration_reports_success():
    calls: list[str] = []

    assert delete_bucket_configuration(
        operation=lambda: calls.append("delete"),
        missing_error_codes={"nosuchbucket"},
        error_message="Unable to delete bucket configuration for 'reports'",
    ) is True
    assert calls == ["delete"]


def test_delete_bucket_configuration_is_idempotent_for_missing_configuration():
    def missing() -> None:
        raise _client_error("NoSuchBucket")

    assert delete_bucket_configuration(
        operation=missing,
        missing_error_codes={"nosuchbucket"},
        error_message="Unable to delete bucket configuration for 'reports'",
    ) is False


def test_delete_bucket_configuration_preserves_client_error_context():
    def denied() -> None:
        raise _client_error("AccessDenied")

    with pytest.raises(RuntimeError, match="Unable to delete bucket policy for 'reports'") as exc_info:
        delete_bucket_configuration(
            operation=denied,
            missing_error_codes={"nosuchbucketpolicy", "nosuchbucket"},
            error_message="Unable to delete bucket policy for 'reports'",
        )

    assert isinstance(exc_info.value.__cause__, ClientError)


def test_delete_bucket_configuration_preserves_transport_error_context():
    def unavailable() -> None:
        raise EndpointConnectionError(endpoint_url="https://s3.example.test")

    with pytest.raises(RuntimeError, match="Unable to delete bucket website for 'reports'") as exc_info:
        delete_bucket_configuration(
            operation=unavailable,
            missing_error_codes={"nosuchwebsiteconfiguration", "nosuchbucket"},
            error_message="Unable to delete bucket website for 'reports'",
        )

    assert isinstance(exc_info.value.__cause__, EndpointConnectionError)
