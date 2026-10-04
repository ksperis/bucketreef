# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.db import StorageEndpoint as DBStorageEndpoint
from app.db import StorageProvider
from app.models.storage_endpoint import (
    StorageEndpoint,
    StorageEndpointAdminOpsPermissions,
)
from app.models.tagging import TagDefinitionSummary


def storage_endpoint_from_db(
    endpoint: DBStorageEndpoint,
    *,
    provider: StorageProvider,
    features: dict[str, dict[str, object]],
    capabilities: dict[str, bool],
    admin_ops_permissions: StorageEndpointAdminOpsPermissions,
    tags: list[TagDefinitionSummary] | None = None,
    ceph_admin_enabled: bool = False,
) -> StorageEndpoint:
    return StorageEndpoint(
        id=endpoint.id,
        name=endpoint.name,
        endpoint_url=endpoint.endpoint_url,
        region=endpoint.region,
        force_path_style=endpoint.force_path_style,
        verify_tls=endpoint.verify_tls,
        latitude=endpoint.latitude,
        longitude=endpoint.longitude,
        provider=provider,
        admin_access_key=endpoint.admin_access_key,
        ceph_admin_allowed=endpoint.ceph_admin_allowed,
        ceph_admin_active=ceph_admin_identity_active(endpoint, ceph_admin_enabled=ceph_admin_enabled),
        service_identities=[dict(kind=row.kind, mode=row.mode, rgw_uid=row.rgw_uid, status=row.status,
                                 credentials_configured=bool(row.access_key and row.secret_key),
                                 last_error=row.last_error, last_reconciled_at=row.last_reconciled_at)
                            for row in endpoint.service_identities],
        capabilities=capabilities,
        admin_ops_permissions=admin_ops_permissions,
        is_default=bool(endpoint.is_default),
        is_editable=bool(endpoint.is_editable),
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
        tags=tags or [],
        has_admin_secret=bool(endpoint.admin_secret_key),
        features_config=endpoint.features_config,
        features=features,
    )


def ceph_admin_identity_active(endpoint, *, ceph_admin_enabled):
    identity = endpoint.service_identity("ceph_admin")
    return bool(endpoint.ceph_admin_allowed and identity and identity.mode == "managed"
                and identity.status == "ready" and identity.access_key and identity.secret_key
                and ceph_admin_enabled)
