# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

from app.core.config import get_settings
from app.db import StorageEndpoint
from app.services.rgw_admin import RGWAdminError, get_rgw_admin_client
from app.services.rgw_admin_identity import (
    classify_rgw_credential_failure,
    extract_ceph_admin_flags,
)
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    resolve_rgw_admin_api_endpoint,
)


@dataclass(frozen=True)
class CephAdminIdentityProbe:
    status: Literal["available", "unavailable", "denied", "misconfigured"]
    warning: Optional[str] = None
    user_payload: Optional[dict] = None


def probe_ceph_admin_service_identity(endpoint: StorageEndpoint) -> CephAdminIdentityProbe:
    configuration_error = validate_ceph_admin_service_configuration(endpoint)
    if configuration_error:
        return CephAdminIdentityProbe(status="misconfigured", warning=configuration_error)
    endpoint_label = endpoint.name or f"#{endpoint.id}"
    admin_endpoint = resolve_rgw_admin_api_endpoint(endpoint)
    identity = endpoint.service_identity("ceph_admin")
    assert identity is not None
    access_key = identity.access_key
    secret_key = identity.secret_key
    try:
        rgw_admin = get_rgw_admin_client(
            access_key=access_key,
            secret_key=secret_key,
            endpoint=admin_endpoint,
            region=endpoint.region,
            verify_tls=endpoint.verify_tls,
            request_timeout_seconds=get_settings().rgw_admin_probe_timeout_seconds,
        )
        user_payload = rgw_admin.get_user_by_access_key(access_key, allow_not_found=True)
    except RGWAdminError as exc:
        failure = classify_rgw_credential_failure(exc)
        if failure == "denied":
            return CephAdminIdentityProbe(
                status="denied",
                warning=f"Ceph Admin credentials were denied for endpoint '{endpoint_label}'.",
            )
        if failure == "misconfigured":
            return CephAdminIdentityProbe(
                status="misconfigured",
                warning="Ceph Admin endpoint configuration is invalid; check the RGW Admin Ops URL and redirects.",
            )
        return CephAdminIdentityProbe(
            status="unavailable",
            warning=f"Ceph Admin endpoint '{endpoint_label}' did not respond while credentials were being checked.",
        )
    if not isinstance(user_payload, dict) or not user_payload:
        return CephAdminIdentityProbe(
            status="denied",
            warning=f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': access key does not map to an RGW user.",
        )
    is_admin, is_system = extract_ceph_admin_flags(user_payload)
    if not is_admin or is_system:
        return CephAdminIdentityProbe(
            status="denied",
            warning=(
                f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': the dedicated access key must belong "
                "to an RGW user configured with admin=true and system=false."
            ),
        )
    return CephAdminIdentityProbe(status="available", user_payload=user_payload)


def validate_ceph_admin_service_identity(endpoint: StorageEndpoint) -> Optional[str]:
    return probe_ceph_admin_service_identity(endpoint).warning


def validate_ceph_admin_service_configuration(endpoint: StorageEndpoint) -> Optional[str]:
    endpoint_label = endpoint.name or f"#{endpoint.id}"
    identity = endpoint.service_identity("ceph_admin")
    if not endpoint.ceph_admin_allowed or identity is None or identity.mode != "external" or identity.status != "ready":
        return f"Ceph Admin is not active for endpoint '{endpoint_label}'; configure and validate its manually supplied credentials."
    if not identity.access_key or not identity.secret_key:
        return (
            f"Ceph Admin workspace is unavailable for endpoint '{endpoint_label}': dedicated Ceph Admin credentials "
            "are not configured."
        )
    return None


def build_ceph_admin_endpoint_payload(endpoint: StorageEndpoint) -> dict:
    features = normalize_features_config(endpoint.provider, endpoint.features_config)
    return {
        "id": endpoint.id,
        "name": endpoint.name,
        "endpoint_url": endpoint.endpoint_url,
        "admin_endpoint": resolve_rgw_admin_api_endpoint(endpoint),
        "region": endpoint.region,
        "is_default": bool(endpoint.is_default),
        "capabilities": features_to_capabilities(features),
    }
