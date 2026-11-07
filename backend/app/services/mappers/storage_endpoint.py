# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import StorageEndpoint as DBStorageEndpoint
from app.core.domain_enums import SERVICE_IDENTITY_ROTATION_KEY_TYPES, StorageProvider
from app.models.storage_endpoint import (
    StorageEndpoint,
    StorageEndpointAdminOpsPermissions,
)
from app.models.tagging import TagDefinitionSummary


def _service_identity_statuses(endpoint: DBStorageEndpoint) -> list[dict[str, object]]:
    pending_by_target = {
        (intent.target_id, intent.key_type): intent
        for intent in endpoint.key_rotation_intents
    }
    statuses: list[dict[str, object]] = []
    for identity in endpoint.service_identities:
        pending = pending_by_target.get(
            (identity.id, SERVICE_IDENTITY_ROTATION_KEY_TYPES[identity.kind])
        )
        statuses.append(
            {
                "kind": identity.kind,
                "mode": identity.mode,
                "rgw_uid": identity.rgw_uid,
                "status": identity.status,
                "credentials_configured": bool(identity.access_key and identity.secret_key),
                "rotation_pending": pending is not None,
                "rotation_phase": pending.phase if pending else None,
                "last_error": identity.last_error,
                "last_reconciled_at": identity.last_reconciled_at,
            }
        )
    return statuses


def storage_endpoint_from_db(
    endpoint: DBStorageEndpoint,
    *,
    provider: StorageProvider,
    features: dict[str, dict[str, object]],
    capabilities: dict[str, bool],
    admin_ops_permissions: StorageEndpointAdminOpsPermissions,
    tags: list[TagDefinitionSummary],
    ceph_admin_enabled: bool = False,
) -> StorageEndpoint:
    return StorageEndpoint(
        id=endpoint.id,
        name=endpoint.name,
        endpoint_url=endpoint.endpoint_url,
        region=endpoint.region,
        realm_id=endpoint.realm_id,
        zonegroup_id=endpoint.zonegroup_id,
        zone_id=endpoint.zone_id,
        force_path_style=endpoint.force_path_style,
        verify_tls=endpoint.verify_tls,
        latitude=endpoint.latitude,
        longitude=endpoint.longitude,
        provider=provider,
        admin_access_key=endpoint.admin_access_key,
        ceph_admin_allowed=endpoint.ceph_admin_allowed,
        ceph_admin_active=ceph_admin_identity_active(endpoint, ceph_admin_enabled=ceph_admin_enabled),
        service_identities=_service_identity_statuses(endpoint),
        capabilities=capabilities,
        admin_ops_permissions=admin_ops_permissions,
        is_default=endpoint.is_default,
        is_editable=endpoint.is_editable,
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
        tags=tags,
        has_admin_secret=bool(endpoint.admin_secret_key),
        features=features,
    )


def ceph_admin_identity_active(endpoint, *, ceph_admin_enabled):
    identity = endpoint.service_identity("ceph_admin")
    return bool(endpoint.ceph_admin_allowed and identity and identity.mode == "external"
                and identity.status == "ready" and identity.access_key and identity.secret_key
                and ceph_admin_enabled)
