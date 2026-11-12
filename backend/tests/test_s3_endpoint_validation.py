# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import ipaddress
from types import SimpleNamespace

import pytest

from app.db import S3Account, S3Connection, StorageEndpoint
from app.core.domain_enums import StorageProvider
from app.services.s3_client_options import (
    resolve_iam_client_options,
    resolve_s3_client_kwargs,
    resolve_s3_client_options,
)
from app.services.s3_execution_context import S3ExecutionContext
from app.utils import s3_endpoint
from app.utils.s3_endpoint import (
    validate_custom_login_s3_endpoint,
    validate_user_supplied_s3_endpoint,
)
from app.utils.s3_connection_endpoint import resolve_connection_iam_options
from app.utils.storage_endpoint_features import AWS_IAM_ENDPOINT, AWS_S3_ENDPOINT
from tests.s3_connection_factory import custom_endpoint_fields
from tests.storage_endpoint_features import persisted_endpoint_features


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("https://s3.example.test/", "https://s3.example.test")],
)
def test_validate_custom_login_s3_endpoint_accepts_expected_urls(monkeypatch, raw: str, expected: str):
    monkeypatch.setattr(s3_endpoint, "validate_outbound_url", lambda *args, **kwargs: None)
    assert validate_custom_login_s3_endpoint(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "ftp://s3.example.test",
        "http://localhost:9000",
        "https://user:pass@s3.example.test",
        "https://s3.example.test?x=1",
        "https://s3.example.test#frag",
        "https:///missing-host",
    ],
)
def test_validate_custom_login_s3_endpoint_rejects_unsafe_urls(monkeypatch, raw: str):
    monkeypatch.setattr(s3_endpoint, "validate_outbound_url", lambda *args, **kwargs: None)
    with pytest.raises(ValueError):
        validate_custom_login_s3_endpoint(raw)


def test_validate_custom_login_s3_endpoint_reports_invalid_port(monkeypatch):
    monkeypatch.setattr(s3_endpoint, "validate_outbound_url", lambda *args, **kwargs: None)

    with pytest.raises(ValueError, match="Custom endpoint URL has an invalid port"):
        validate_custom_login_s3_endpoint("https://s3.example.test:not-a-port")


def test_production_user_supplied_endpoint_requires_operator_allowlist(monkeypatch):
    monkeypatch.setattr(s3_endpoint.settings, "app_env", "production")
    monkeypatch.setattr(s3_endpoint.settings, "user_supplied_s3_endpoint_allowed_hosts", [])
    monkeypatch.setattr(
        "app.utils.network_targets.resolve_hostname_ips",
        lambda _host: {ipaddress.ip_address("93.184.216.34")},
    )

    with pytest.raises(ValueError, match="host is not allowed by policy"):
        validate_user_supplied_s3_endpoint("https://s3.example.test")


def test_production_user_supplied_endpoint_accepts_exact_operator_allowlist(monkeypatch):
    monkeypatch.setattr(s3_endpoint.settings, "app_env", "production")
    monkeypatch.setattr(
        s3_endpoint.settings,
        "user_supplied_s3_endpoint_allowed_hosts",
        ["s3.example.test"],
    )
    monkeypatch.setattr(
        "app.utils.network_targets.resolve_hostname_ips",
        lambda _host: {ipaddress.ip_address("93.184.216.34")},
    )

    assert validate_user_supplied_s3_endpoint("https://s3.example.test/") == "https://s3.example.test"


def test_development_user_supplied_endpoint_keeps_public_https_policy(monkeypatch):
    monkeypatch.setattr(s3_endpoint.settings, "app_env", "development")
    monkeypatch.setattr(s3_endpoint.settings, "user_supplied_s3_endpoint_allowed_hosts", [])
    monkeypatch.setattr(
        "app.utils.network_targets.resolve_hostname_ips",
        lambda _host: {ipaddress.ip_address("93.184.216.34")},
    )

    assert validate_user_supplied_s3_endpoint("https://public.example.test") == "https://public.example.test"


def test_resolve_iam_client_options_uses_aws_iam_endpoint_for_aws_storage_endpoint():
    endpoint = StorageEndpoint(
        name="AWS",
        endpoint_url=AWS_S3_ENDPOINT,
        provider=StorageProvider.AWS.value,
        region="eu-west-1",
        verify_tls=True,
        features=persisted_endpoint_features(provider=StorageProvider.AWS),
    )
    account = S3Account(storage_endpoint=endpoint)

    assert resolve_iam_client_options(account) == (AWS_IAM_ENDPOINT, "us-east-1", True)


def test_resolve_connection_iam_options_uses_custom_aws_iam_endpoint():
    connection = S3Connection(
        created_by_user_id=1,
        name="AWS custom",
        **custom_endpoint_fields(
            "https://s3.eu-west-1.amazonaws.com",
            region="eu-west-1",
            provider=" AWS ",
            verify_tls=False,
        ),
        access_key_id="AK",
        secret_access_key="SK",
    )

    assert resolve_connection_iam_options(connection) == (
        AWS_IAM_ENDPOINT,
        "us-east-1",
        False,
    )


def test_resolve_connection_iam_options_respects_disabled_endpoint_iam():
    endpoint = StorageEndpoint(
        name="AWS disabled IAM",
        endpoint_url=AWS_S3_ENDPOINT,
        provider=StorageProvider.AWS.value,
        region="eu-west-1",
        verify_tls=True,
        features=persisted_endpoint_features(
            "features:\n  iam:\n    enabled: false\n",
            provider=StorageProvider.AWS,
        ),
    )
    connection = S3Connection(
        created_by_user_id=1,
        name="AWS endpoint",
        storage_endpoint=endpoint,
        access_key_id="AK",
        secret_access_key="SK",
    )

    assert resolve_connection_iam_options(connection) == (None, "us-east-1", True)


def test_resolve_s3_client_options_uses_storage_endpoint_force_path_style():
    endpoint = StorageEndpoint(
        name="Path Style",
        endpoint_url="https://s3.path-style.example.test",
        provider=StorageProvider.OTHER.value,
        region="eu-west-1",
        force_path_style=True,
        verify_tls=True,
    )
    account = S3Account(storage_endpoint=endpoint)

    assert resolve_s3_client_options(account) == (
        "https://s3.path-style.example.test",
        "eu-west-1",
        True,
        True,
    )
    assert resolve_s3_client_kwargs(account) == {
        "endpoint": "https://s3.path-style.example.test",
        "region": "eu-west-1",
        "force_path_style": True,
        "verify_tls": True,
    }


def test_resolve_s3_client_options_rejects_legacy_account_like_target():
    target = SimpleNamespace(storage_endpoint=None)

    with pytest.raises(TypeError, match="S3Account or S3ExecutionContext"):
        resolve_s3_client_options(target)


def test_resolve_s3_client_options_uses_explicitsession_endpoint_override():
    endpoint = StorageEndpoint(
        name="Configured",
        endpoint_url="https://configured.example.test",
        provider=StorageProvider.OTHER.value,
        region="eu-west-1",
        force_path_style=True,
        verify_tls=True,
    )
    account = S3ExecutionContext(
        context_id="conn-1",
        context_kind="connection",
        name="Session override",
        access_key="AK",
        secret_key="SK",
        storage_endpoint=endpoint,
        session_endpoint="https://session.example.test",
    )

    assert resolve_s3_client_options(account) == (
        "https://session.example.test",
        "eu-west-1",
        True,
        True,
    )


def test_resolve_s3_client_optionssession_force_path_style_overrides_endpoint():
    endpoint = StorageEndpoint(
        name="Path Style",
        endpoint_url="https://s3.path-style.example.test",
        provider=StorageProvider.OTHER.value,
        region="eu-west-1",
        force_path_style=True,
        verify_tls=True,
    )
    account = S3ExecutionContext(
        context_id="conn-1",
        context_kind="connection",
        name="Session path style",
        access_key="AK",
        secret_key="SK",
        storage_endpoint=endpoint,
        session_force_path_style=False,
    )

    assert resolve_s3_client_options(account) == (
        "https://s3.path-style.example.test",
        "eu-west-1",
        False,
        True,
    )


def test_resolve_iam_client_options_uses_aws_iam_signing_region_for_connection_context():
    endpoint = StorageEndpoint(
        name="AWS",
        endpoint_url="https://s3.eu-west-1.amazonaws.com",
        provider=StorageProvider.AWS.value,
        region="eu-west-1",
        verify_tls=True,
        features=persisted_endpoint_features(provider=StorageProvider.AWS),
    )
    account = S3ExecutionContext(
        context_id="conn-1",
        context_kind="connection",
        name="AWS connection",
        access_key="AK",
        secret_key="SK",
        storage_endpoint=endpoint,
        session_region="eu-west-1",
    )

    assert resolve_iam_client_options(account) == (AWS_IAM_ENDPOINT, "us-east-1", True)
