# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from dataclasses import replace
from types import SimpleNamespace

import pytest

from app.db import S3Account, StorageEndpoint
from app.services.s3_execution_client import (
    require_s3_execution_credentials,
    s3_execution_cache_key,
    s3_execution_client_kwargs,
)
from app.services.s3_execution_context import S3ExecutionContext


def test_require_s3_execution_credentials_preserves_requested_error() -> None:
    account = SimpleNamespace(effective_rgw_credentials=lambda: (None, None))

    with pytest.raises(RuntimeError, match="custom credentials error"):
        require_s3_execution_credentials(
            account,
            error_message="custom credentials error",
        )


def test_s3_execution_client_kwargs_includes_session_overrides() -> None:
    account = SimpleNamespace(
        storage_endpoint=None,
        session_endpoint="https://s3.example.test",
        session_region="us-east-2",
        session_force_path_style=True,
        session_verify_tls=False,
        session_token=lambda: "session-token",
    )

    assert s3_execution_client_kwargs(account) == {
        "endpoint": "https://s3.example.test",
        "region": "us-east-2",
        "force_path_style": True,
        "verify_tls": False,
        "session_token": "session-token",
    }


def test_s3_execution_cache_key_matches_account_and_explicit_context() -> None:
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

    assert s3_execution_cache_key(account) == s3_execution_cache_key(context)
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
