# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Synchronize storage endpoints managed by ENV_STORAGE_ENDPOINTS."""

from __future__ import annotations

import logging
from dataclasses import replace

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.runtime_surfaces import endpoint_identity_management_enabled
from app.db import StorageEndpoint, User
from app.core.domain_enums import StorageProvider
from app.services.endpoint_service_identities import EndpointServiceIdentityService
from app.services.operation_lease_service import OperationLeaseService
from app.services.storage_endpoint_normalization import (
    NormalizedEndpointState,
    normalize_env_storage_endpoint_states,
    parse_env_storage_endpoints,
)
from app.services.storage_endpoint_state import apply_storage_endpoint_state
from app.services.storage_endpoint_uniqueness import (
    ensure_unique_storage_endpoint_name,
    ensure_unique_storage_endpoint_url,
)
from app.utils.storage_endpoint_features import (
    normalize_features,
    required_service_identity_kinds,
)


logger = logging.getLogger(__name__)
settings = get_settings()


class StorageEndpointEnvSyncService:
    """Own ENV endpoint synchronization, identity transitions, and locking."""

    def __init__(self, db: Session, *, actor: User | None = None) -> None:
        self.db = db
        self.actor = actor

    def sync(self) -> list[StorageEndpoint] | None:
        # Validate the whole inventory before any write, even when another instance
        # currently holds the synchronization lease.
        configs = normalize_env_storage_endpoint_states(
            parse_env_storage_endpoints(settings.env_storage_endpoints)
        )
        if not configs:
            self._unlock_removed_env_inventory()
            return []

        lease = OperationLeaseService(self.db)
        handle = lease.acquire("endpoints:env-sync", ttl_seconds=7200)
        if handle is None:
            return None
        try:
            return self._sync(configs)
        finally:
            lease.release(handle)

    def _unlock_removed_env_inventory(self) -> None:
        env_locked_endpoints = self.db.scalars(
            select(StorageEndpoint).where(StorageEndpoint.is_editable.is_(False))
        ).all()
        for endpoint in env_locked_endpoints:
            endpoint.is_editable = True
            self.db.add(endpoint)
        if env_locked_endpoints:
            self.db.commit()

    def _sync(
        self,
        configs: list[NormalizedEndpointState],
        *,
        _retry_on_integrity: bool = True,
    ) -> list[StorageEndpoint]:
        existing_by_url = {
            endpoint.endpoint_url: endpoint
            for endpoint in self.db.scalars(select(StorageEndpoint)).all()
        }
        try:
            for config in configs:
                self._upsert(config, existing_by_url)
            default_config = next(config for config in configs if config.is_default)
            self._clear_other_defaults(default_config.endpoint_url)
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            if not _retry_on_integrity:
                raise
            logger.info(
                "ENV_STORAGE_ENDPOINTS sync hit a concurrent insert; "
                "reloading existing endpoints."
            )
            return self._sync(configs, _retry_on_integrity=False)
        return self._load_synced(configs)

    def _upsert(
        self,
        config: NormalizedEndpointState,
        existing_by_url: dict[str, StorageEndpoint],
    ) -> StorageEndpoint:
        endpoint = self._resolve(config, existing_by_url)
        identities = EndpointServiceIdentityService(self.db, actor=self.actor)
        lease, handle = (
            identities.lease(endpoint)
            if endpoint.id is not None
            else (None, None)
        )
        try:
            required = required_service_identity_kinds(
                normalize_features(
                    config.provider,
                    config.features,
                    config.region,
                )
            )
            config = self._preserve_unused_external_credentials(
                endpoint,
                config,
                required,
            )
            identity_management_enabled = endpoint_identity_management_enabled(settings)
            self._prepare_identity_transition(
                endpoint,
                config,
                required,
                identities,
                identity_management_enabled=identity_management_enabled,
            )
            apply_storage_endpoint_state(endpoint, config)
            endpoint.is_default = config.is_default
            endpoint.is_editable = False
            self.db.add(endpoint)
            self.db.commit()
            if identity_management_enabled and endpoint.provider == "ceph":
                identities.reconcile(
                    endpoint,
                    locked=handle is not None,
                    provision_unprovisioned=True,
                )
        finally:
            if lease is not None:
                lease.release(handle)
        return endpoint

    def _resolve(
        self,
        config: NormalizedEndpointState,
        existing_by_url: dict[str, StorageEndpoint],
    ) -> StorageEndpoint:
        endpoint = existing_by_url.get(config.endpoint_url)
        if endpoint is not None:
            ensure_unique_storage_endpoint_name(
                self.db,
                config.name,
                exclude_id=endpoint.id,
            )
            return endpoint

        ensure_unique_storage_endpoint_name(self.db, config.name)
        ensure_unique_storage_endpoint_url(self.db, config.endpoint_url)
        endpoint = StorageEndpoint(
            name=config.name,
            endpoint_url=config.endpoint_url,
        )
        existing_by_url[config.endpoint_url] = endpoint
        return endpoint

    @staticmethod
    def _preserve_unused_external_credentials(
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        required: set[str],
    ) -> NormalizedEndpointState:
        if config.service_identity_mode != "external":
            return config

        preserved_credentials: dict[str, str | None] = {}
        for kind in ("runtime", "supervision"):
            identity = endpoint.service_identity(kind)
            if (
                kind not in required
                and identity is not None
                and identity.mode == "external"
                and not getattr(config, f"{kind}_access_key")
                and not getattr(config, f"{kind}_secret_key")
            ):
                # Disabling a feature does not remove its existing identity.
                preserved_credentials[f"{kind}_access_key"] = identity.access_key
                preserved_credentials[f"{kind}_secret_key"] = identity.secret_key
        if not preserved_credentials:
            return config
        return replace(config, **preserved_credentials)

    @staticmethod
    def _has_configured_service_identity(endpoint: StorageEndpoint) -> bool:
        return any(
            identity.kind in ("runtime", "supervision")
            and any(
                (
                    identity.rgw_uid,
                    identity.access_key,
                    identity.secret_key,
                    identity.provenance,
                )
            )
            for identity in endpoint.service_identities
        )

    def _prepare_identity_transition(
        self,
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        required: set[str],
        identities: EndpointServiceIdentityService,
        *,
        identity_management_enabled: bool,
    ) -> None:
        self._validate_external_to_managed_transition(
            endpoint,
            config,
            required,
            identities,
            identity_management_enabled=identity_management_enabled,
        )
        if endpoint.id is None:
            return
        if self._revoke_identities_for_provider_change(
            endpoint,
            config,
            identities,
            identity_management_enabled=identity_management_enabled,
        ):
            return
        self._prepare_managed_to_external_transition(
            endpoint,
            config,
            required,
            identities,
            identity_management_enabled=identity_management_enabled,
        )

    def _validate_external_to_managed_transition(
        self,
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        required: set[str],
        identities: EndpointServiceIdentityService,
        *,
        identity_management_enabled: bool,
    ) -> None:
        runtime = endpoint.service_identity("runtime")
        configured_services = self._has_configured_service_identity(endpoint)
        if (
            runtime is not None
            and runtime.mode == "external"
            and config.service_identity_mode == "managed"
            and (required or configured_services)
        ):
            if not identity_management_enabled:
                raise ValueError(
                    "ENV identity conversion requires an administration instance."
                )
            _, permissions = identities.admin_permissions(config)
            if not permissions.users_write:
                raise ValueError(
                    "Managed identity conversion requires Admin Ops users=write."
                )

    @staticmethod
    def _revoke_identities_for_provider_change(
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        identities: EndpointServiceIdentityService,
        *,
        identity_management_enabled: bool,
    ) -> bool:
        if config.provider != StorageProvider.CEPH and identity_management_enabled:
            for kind in ("runtime", "supervision", "ceph_admin"):
                if not identities.revoke(endpoint, kind):
                    raise ValueError(
                        "Managed identity revocation is pending; retry before "
                        "changing the ENV provider."
                    )
            return True
        return False

    @staticmethod
    def _prepare_managed_to_external_transition(
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        required: set[str],
        identities: EndpointServiceIdentityService,
        *,
        identity_management_enabled: bool,
    ) -> None:
        if config.service_identity_mode != "external":
            return

        for kind in ("runtime", "supervision"):
            identity = endpoint.service_identity(kind)
            if identity is None or identity.mode != "managed":
                continue
            replacing_managed = any(
                (
                    identity.rgw_uid,
                    identity.access_key,
                    identity.secret_key,
                    identity.provenance,
                )
            )
            if (kind in required or replacing_managed) and (
                not getattr(config, f"{kind}_access_key")
                or not getattr(config, f"{kind}_secret_key")
            ):
                raise ValueError(
                    "ENV conversion to external mode requires replacement "
                    "service credentials."
                )
            if not identity_management_enabled:
                raise ValueError(
                    "ENV identity conversion requires an administration instance."
                )
            if not identities.revoke(endpoint, kind):
                raise ValueError(
                    "Managed identity revocation is pending; retry ENV synchronization."
                )
            identity.mode = "external"

    def _clear_other_defaults(self, default_url: str) -> None:
        endpoints = self.db.scalars(
            select(StorageEndpoint).where(
                StorageEndpoint.endpoint_url != default_url
            )
        )
        for endpoint in endpoints:
            if endpoint.is_default:
                endpoint.is_default = False
                self.db.add(endpoint)

    def _load_synced(
        self,
        configs: list[NormalizedEndpointState],
    ) -> list[StorageEndpoint]:
        synced: list[StorageEndpoint] = []
        for config in configs:
            endpoint = self.db.scalar(
                select(StorageEndpoint)
                .where(StorageEndpoint.endpoint_url == config.endpoint_url)
                .limit(1)
            )
            if endpoint is not None:
                synced.append(endpoint)
        return synced
