# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import replace
import pytest

from app.db import S3Account, StorageEndpoint
from app.services.s3_client import S3OperationError
from app.services.s3_execution_client import (
    S3ExecutionCredentialsError,
    require_s3_execution_credentials,
    require_s3_execution_credentials_with_error,
    s3_execution_cache_key,
    s3_execution_client_kwargs,
    s3_execution_request_kwargs,
)
from app.services.s3_execution_context import S3ExecutionContext


def test_require_s3_execution_credentials_preserves_requested_error() -> None:
    account = S3ExecutionContext(
        context_id="42",
        context_kind="account",
        name="missing-credentials",
        access_key=None,
        secret_key=None,
    )

    with pytest.raises(S3ExecutionCredentialsError, match="custom credentials error"):
        require_s3_execution_credentials(
            account,
            error_message="custom credentials error",
        )


def test_require_s3_execution_credentials_with_error_preserves_cause() -> None:
    account = S3ExecutionContext(
        context_id="42",
        context_kind="account",
        name="missing-credentials",
        access_key=None,
        secret_key=None,
    )

    with pytest.raises(S3OperationError, match="custom credentials error") as raised:
        require_s3_execution_credentials_with_error(
            account,
            error_message="custom credentials error",
            error_type=S3OperationError,
        )

    assert isinstance(raised.value.__cause__, S3ExecutionCredentialsError)


def test_require_s3_execution_credentials_with_error_preserves_unexpected_failure() -> None:
    class BrokenContext:
        @staticmethod
        def effective_rgw_credentials():
            raise RuntimeError("unexpected credential resolver bug")

    with pytest.raises(RuntimeError, match="unexpected credential resolver bug"):
        require_s3_execution_credentials_with_error(
            BrokenContext(),
            error_message="custom credentials error",
            error_type=S3OperationError,
        )


def test_s3_execution_client_kwargs_includes_session_overrides() -> None:
    account = S3ExecutionContext(
        context_id="42",
        context_kind="account",
        name="session-overrides",
        access_key="access-key",
        secret_key="secret-key",
        session_endpoint="https://s3.example.test",
        session_region="us-east-2",
        session_force_path_style=True,
        session_verify_tls=False,
        session_token_value="session-token",
    )

    assert s3_execution_client_kwargs(account) == {
        "endpoint": "https://s3.example.test",
        "region": "us-east-2",
        "force_path_style": True,
        "verify_tls": False,
        "session_token": "session-token",
    }


def test_s3_execution_request_kwargs_includes_credentials_and_client_options() -> None:
    account = S3ExecutionContext(
        context_id="42",
        context_kind="account",
        name="request-options",
        access_key="access-key",
        secret_key="secret-key",
        session_endpoint="https://s3.example.test",
        session_region="us-east-2",
        session_force_path_style=True,
        session_verify_tls=False,
        session_token_value="session-token",
    )

    assert s3_execution_request_kwargs(
        account,
        error_message="credentials are required",
    ) == {
        "access_key": "access-key",
        "secret_key": "secret-key",
        "endpoint": "https://s3.example.test",
        "region": "us-east-2",
        "force_path_style": True,
        "verify_tls": False,
        "session_token": "session-token",
    }


def test_s3_execution_request_kwargs_uses_default_credentials_error() -> None:
    account = S3ExecutionContext(
        context_id="42",
        context_kind="account",
        name="missing-credentials",
        access_key=None,
        secret_key=None,
    )

    with pytest.raises(
        S3OperationError,
        match="S3 execution context is missing credentials",
    ) as raised:
        s3_execution_request_kwargs(account)

    assert isinstance(raised.value.__cause__, S3ExecutionCredentialsError)


def test_s3_execution_request_kwargs_preserves_unexpected_credential_failure() -> None:
    class BrokenContext:
        @staticmethod
        def effective_rgw_credentials():
            raise RuntimeError("unexpected credential resolver bug")

    with pytest.raises(RuntimeError, match="unexpected credential resolver bug"):
        s3_execution_request_kwargs(BrokenContext())


def test_s3_execution_cache_key_ignores_display_name() -> None:
    account = S3Account(
        id=42,
        name="cache-account",
        rgw_access_key="test-access-key",
        rgw_secret_key="test-secret-key",
        storage_endpoint=StorageEndpoint(
            name="cache-endpoint",
            endpoint_url="https://s3.example.test",
            region="us-east-1",
            force_path_style=True,
            verify_tls=True,
        ),
    )
    access_key, secret_key = account.effective_rgw_credentials()
    context = S3ExecutionContext.from_account(
        account, access_key=access_key, secret_key=secret_key,
    )

    assert s3_execution_cache_key(context) == s3_execution_cache_key(
        replace(context, name="renamed-account"),
    )


def test_s3_execution_cache_key_keeps_context_kinds_separate() -> None:
    account = S3ExecutionContext(
        context_id="42", context_kind="account", name="cache-account",
        access_key="test-access-key", secret_key="test-secret-key",
    )
    fingerprints = {
        s3_execution_cache_key(replace(account, context_kind=kind))
        for kind in ("account", "connection", "s3_user", "portal_account", "ceph_admin", "session")
    }

    assert len(fingerprints) == 6
    assert all(len(key) == 64 and set(key) <= set("0123456789abcdef") for key in fingerprints)


def test_s3_execution_cache_key_serializes_fields_without_delimiter_collisions() -> None:
    account = S3ExecutionContext(
        context_id="42", context_kind="account", name="cache-account",
        access_key="access|part", secret_key="secret",
    )
    other = replace(account, access_key="access", secret_key="part|secret")

    assert s3_execution_cache_key(account) != s3_execution_cache_key(other)
