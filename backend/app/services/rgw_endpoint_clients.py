# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import StorageEndpoint
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.utils.storage_endpoint_features import resolve_admin_endpoint, resolve_rgw_admin_api_endpoint


def get_endpoint_service_rgw_client(endpoint: StorageEndpoint, kind: str) -> RGWAdminClient:
    identity = endpoint.service_identity(kind)
    if identity is None or identity.status != "ready" or not identity.access_key or not identity.secret_key:
        raise ValueError(f"{kind} service identity is not ready for this endpoint")
    return get_rgw_admin_client(
        access_key=identity.access_key, secret_key=identity.secret_key,
        endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region,
        verify_tls=endpoint.verify_tls,
    )


def get_endpoint_runtime_rgw_client(endpoint: StorageEndpoint) -> RGWAdminClient:
    return get_endpoint_service_rgw_client(endpoint, "runtime")


def get_endpoint_bootstrap_rgw_client(endpoint: StorageEndpoint) -> RGWAdminClient:
    return get_rgw_admin_client(access_key=endpoint.admin_access_key, secret_key=endpoint.admin_secret_key,
                                endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region,
                                verify_tls=endpoint.verify_tls)


def get_endpoint_admin_rgw_client(
    endpoint: StorageEndpoint,
    *,
    access_key: str | None = None,
    secret_key: str | None = None,
) -> RGWAdminClient:
    return get_rgw_admin_client(
        access_key=endpoint.admin_access_key if access_key is None else access_key,
        secret_key=endpoint.admin_secret_key if secret_key is None else secret_key,
        endpoint=resolve_admin_endpoint(endpoint),
        region=endpoint.region,
        verify_tls=endpoint.verify_tls,
    )
