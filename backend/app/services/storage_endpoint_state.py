# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Apply normalized storage-endpoint state to persisted endpoint models."""

from __future__ import annotations

from typing import Optional

from app.db import EndpointServiceIdentity, StorageEndpoint, StorageProvider
from app.services.storage_endpoint_normalization import NormalizedEndpointState
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint


def apply_storage_endpoint_state(
    endpoint: StorageEndpoint,
    config: NormalizedEndpointState,
) -> None:
    old_target = _endpoint_target(endpoint) if endpoint.provider else None
    _apply_endpoint_fields(endpoint, config)
    if config.provider == StorageProvider.CEPH:
        _apply_ceph_service_identities(endpoint, config)
    endpoint.features = config.features
    if old_target != _endpoint_target(endpoint):
        _invalidate_external_service_identities(endpoint)


def _set_service_identity_mode(identity: EndpointServiceIdentity, mode: str) -> None:
    if identity.mode == mode:
        return
    identity.mode = mode
    identity.rgw_uid = None
    identity.access_key = None
    identity.secret_key = None
    identity.provenance = None
    identity.status = "not_provisioned" if mode == "managed" else "missing"
    identity.last_error = None
    identity.last_reconciled_at = None


def _endpoint_target(endpoint: StorageEndpoint) -> tuple[str, str, str | None]:
    return (
        endpoint.endpoint_url,
        resolve_rgw_admin_api_endpoint(endpoint),
        endpoint.region,
    )


def _apply_endpoint_fields(
    endpoint: StorageEndpoint,
    config: NormalizedEndpointState,
) -> None:
    endpoint.name = config.name
    endpoint.endpoint_url = config.endpoint_url
    endpoint.region = config.region
    endpoint.realm_id = config.realm_id
    endpoint.zonegroup_id = config.zonegroup_id
    endpoint.zone_id = config.zone_id
    endpoint.force_path_style = config.force_path_style
    endpoint.verify_tls = config.verify_tls
    endpoint.latitude = config.latitude
    endpoint.longitude = config.longitude
    endpoint.provider = config.provider.value
    endpoint.admin_access_key = config.admin_access_key
    endpoint.admin_secret_key = config.admin_secret_key
    endpoint.ceph_admin_allowed = config.ceph_admin_allowed


def _apply_ceph_service_identities(
    endpoint: StorageEndpoint,
    config: NormalizedEndpointState,
) -> None:
    runtime = _ensure_service_identity(
        endpoint,
        "runtime",
        config.service_identity_mode,
    )
    if runtime.mode == "external":
        _apply_external_credentials(
            runtime,
            config.runtime_access_key,
            config.runtime_secret_key,
        )

    supervision = _ensure_service_identity(endpoint, "supervision", runtime.mode)
    if supervision.mode == "external":
        _apply_external_credentials(
            supervision,
            config.supervision_access_key,
            config.supervision_secret_key,
        )

    ceph_admin = endpoint.service_identity("ceph_admin")
    if ceph_admin is None and (
        config.ceph_admin_access_key
        or config.ceph_admin_secret_key
        or endpoint.ceph_admin_allowed
    ):
        ceph_admin = EndpointServiceIdentity(
            kind="ceph_admin",
            mode="external",
            status="missing",
        )
        endpoint.service_identities.append(ceph_admin)
    if ceph_admin is not None:
        _apply_external_credentials(
            ceph_admin,
            config.ceph_admin_access_key,
            config.ceph_admin_secret_key,
        )


def _ensure_service_identity(
    endpoint: StorageEndpoint,
    kind: str,
    mode: str,
) -> EndpointServiceIdentity:
    identity = endpoint.service_identity(kind)
    if identity is None:
        identity = EndpointServiceIdentity(
            kind=kind,
            mode=mode,
            status="not_provisioned" if mode == "managed" else "missing",
        )
        endpoint.service_identities.append(identity)
        return identity
    _set_service_identity_mode(identity, mode)
    return identity


def _invalidate_external_service_identities(endpoint: StorageEndpoint) -> None:
    for identity in endpoint.service_identities:
        if identity.mode == "external":
            identity.status = "missing"
            identity.last_error = None
            identity.last_reconciled_at = None


def _apply_external_credentials(
    identity: EndpointServiceIdentity,
    access: Optional[str],
    secret: Optional[str],
) -> None:
    if (identity.access_key, identity.secret_key) != (access, secret):
        identity.access_key, identity.secret_key = access, secret
        identity.status = "missing"
        identity.last_error = None
        identity.last_reconciled_at = None
