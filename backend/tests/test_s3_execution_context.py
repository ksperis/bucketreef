# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from types import SimpleNamespace

from app.services.s3_execution_context import S3ExecutionContext, build_ceph_admin_s3_context


def test_build_ceph_admin_s3_context_preserves_endpoint_identity_and_credentials() -> None:
    endpoint = SimpleNamespace(id=7)
    source = SimpleNamespace(
        endpoint=endpoint,
        access_key="AKIA-ADMIN",
        secret_key="SECRET-ADMIN",
    )

    context = build_ceph_admin_s3_context(source)

    assert context.context_id == "ceph-admin-7"
    assert context.context_kind == "ceph_admin"
    assert context.storage_endpoint is endpoint
    assert context.storage_endpoint_id == 7
    assert context.ceph_admin_endpoint_id == 7
    assert context.effective_rgw_credentials() == ("AKIA-ADMIN", "SECRET-ADMIN")


def test_connection_metadata_context_reuses_endpoint_projection_without_credentials() -> None:
    endpoint = SimpleNamespace(
        id=3,
        name="S3 Endpoint",
        provider="ceph",
        endpoint_url="https://s3.example.test",
        region="us-east-1",
        force_path_style=True,
        verify_tls=True,
    )
    connection = SimpleNamespace(
        id=9,
        name="connection-a",
        access_key_id="AKIA-CONNECTION",
        secret_access_key="SECRET-CONNECTION",
        session_token="SESSION-CONNECTION",
        rgw_account_id="RGWACCOUNT",
        rgw_user_uid="tenant$user",
        rgw_tenant="tenant",
        storage_endpoint_id=3,
        storage_endpoint=endpoint,
        custom_endpoint_url=None,
        custom_region=None,
        custom_force_path_style=None,
        custom_verify_tls=None,
        custom_provider=None,
    )

    context = S3ExecutionContext.from_connection(connection, metadata_only=True)

    assert context.context_id == "conn-9"
    assert context.name == "connection-a"
    assert context.effective_rgw_credentials() == (None, None)
    assert context.session_token() is None
    assert context.session_endpoint == "https://s3.example.test"
    assert context.session_region == "us-east-1"
    assert context.session_force_path_style is True
    assert context.session_verify_tls is True
    assert context.s3_connection_id == 9
    assert context.rgw_account_id is None
    assert context.rgw_user_uid is None
    assert context.rgw_tenant is None
    assert context.source_connection is None


def test_s3_user_metadata_context_omits_identity_and_credentials() -> None:
    endpoint = SimpleNamespace(id=4)
    user = SimpleNamespace(
        id=11,
        name="s3-user-a",
        rgw_access_key="AKIA-USER",
        rgw_secret_key="SECRET-USER",
        email="user@example.test",
        rgw_user_uid="tenant$user",
        rgw_tenant="tenant",
        storage_endpoint_id=4,
        storage_endpoint=endpoint,
    )

    context = S3ExecutionContext.from_s3_user(user, metadata_only=True)

    assert context.context_id == "s3u-11"
    assert context.name == "s3-user-a"
    assert context.effective_rgw_credentials() == (None, None)
    assert context.storage_endpoint is endpoint
    assert context.storage_endpoint_id == 4
    assert context.email is None
    assert context.rgw_user_uid is None
    assert context.rgw_tenant is None
    assert context.s3_user_id is None
    assert context.source_s3_user is None
