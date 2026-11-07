# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.domain_enums import StorageProvider
from app.db import StorageEndpoint
from app.models.storage_endpoint import (
    StorageEndpointAdminOpsPermissions,
    StorageEndpoint as StorageEndpointSchema,
)
from app.services.mappers.storage_endpoint import storage_endpoint_from_db
from app.services.rgw_admin import RGWAdminClient, get_rgw_admin_client
from app.services.storage_endpoint_admin_permissions import (
    resolve_storage_endpoint_admin_ops_permissions,
)
from app.services.storage_endpoint_repository import StorageEndpointRepository
from app.services.tags_service import TagsService
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    validate_persisted_features,
)


class StorageEndpointQueryService:
    """Read and serialize configured storage endpoints."""

    def __init__(
        self,
        db: Session,
        *,
        repository: StorageEndpointRepository | None = None,
        tags: TagsService | None = None,
        admin_client_factory: Callable[..., RGWAdminClient] | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or StorageEndpointRepository(db)
        self.tags = tags or TagsService(db)
        self.admin_client_factory = admin_client_factory or get_rgw_admin_client

    def _ceph_admin_enabled(self) -> bool:
        from app.services.app_settings_service import load_app_settings_for_db

        return load_app_settings_for_db(self.db).general.ceph_admin_enabled

    def serialize_endpoint(
        self,
        endpoint: StorageEndpoint,
        *,
        include_admin_ops_permissions: bool = True,
    ) -> StorageEndpointSchema:
        provider = StorageProvider(endpoint.provider)
        features = validate_persisted_features(provider, endpoint.features)
        capabilities = features_to_capabilities(features)
        admin_ops_permissions = (
            resolve_storage_endpoint_admin_ops_permissions(
                endpoint,
                provider=provider,
                client_factory=self.admin_client_factory,
            )
            if include_admin_ops_permissions
            else StorageEndpointAdminOpsPermissions.empty()
        )
        return storage_endpoint_from_db(
            endpoint,
            provider=provider,
            features=features,
            capabilities=capabilities,
            admin_ops_permissions=admin_ops_permissions,
            tags=self.tags.get_storage_endpoint_tags(endpoint),
            ceph_admin_enabled=self._ceph_admin_enabled(),
        )

    def list_endpoints(
        self,
        *,
        include_admin_ops_permissions: bool = False,
    ) -> list[StorageEndpointSchema]:
        return [
            self.serialize_endpoint(
                endpoint,
                include_admin_ops_permissions=include_admin_ops_permissions,
            )
            for endpoint in self.repository.list_ordered()
        ]

    def get_endpoint(
        self,
        endpoint_id: int,
        *,
        include_admin_ops_permissions: bool = True,
    ) -> StorageEndpointSchema:
        return self.serialize_endpoint(
            self.repository.get(endpoint_id),
            include_admin_ops_permissions=include_admin_ops_permissions,
        )
