# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from dataclasses import replace
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import (
    EndpointServiceIdentity,
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
)
from app.models.storage_endpoint import (
    StorageEndpointFeatureDetectionRequest,
    StorageEndpointFeatureDetectionResult,
    StorageEndpointAdminOpsPermissions,
    StorageEndpoint as StorageEndpointSchema,
    StorageEndpointCreate,
    StorageEndpointTagsUpdate,
    StorageEndpointUpdate,
)
from app.services.mappers.storage_endpoint import storage_endpoint_from_db
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import get_rgw_admin_client
from app.services.storage_endpoint_admin_permissions import (
    resolve_storage_endpoint_admin_ops_permissions,
)
from app.services.storage_endpoint_feature_detection import (
    StorageEndpointFeatureDetector,
)
from app.services.storage_endpoint_normalization import (
    NormalizedEndpointState,
    normalize_env_storage_endpoint_states,
    normalize_storage_endpoint_state,
    normalize_storage_endpoint_update,
    parse_env_storage_endpoints,
)
from app.services.tags_service import TagsService
from app.utils.tagging import (
    TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN,
    TAG_DOMAIN_BUCKET_UI_STORAGE_OPS,
    TAG_DOMAIN_ENDPOINT,
)
from app.utils.s3_endpoint import configured_s3_endpoint
from app.utils.name_ordering import name_order_by
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features_config,
    required_service_identity_kinds,
    resolve_rgw_admin_api_endpoint,
)

logger = logging.getLogger(__name__)
settings = get_settings()

class StorageEndpointsService:
    def __init__(self, db: Session, *, actor: User | None = None) -> None:
        self.db = db
        self.actor = actor
        self.tags = TagsService(db)

    def env_endpoints_locked(self) -> bool:
        raw = settings.env_storage_endpoints
        return bool(raw and raw.strip())

    def _ensure_env_editable(self) -> None:
        if self.env_endpoints_locked():
            raise ValueError("Storage endpoints are managed by ENV_STORAGE_ENDPOINTS.")

    def _serialize(
        self,
        endpoint: StorageEndpoint,
        *,
        include_admin_ops_permissions: bool = True,
    ) -> StorageEndpointSchema:
        provider = StorageProvider(endpoint.provider)
        features = normalize_features_config(
            provider,
            endpoint.features_config,
            endpoint.region,
        )
        capabilities = features_to_capabilities(features)
        admin_ops_permissions = (
            resolve_storage_endpoint_admin_ops_permissions(
                endpoint,
                provider=provider,
                client_factory=get_rgw_admin_client,
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

    def _ceph_admin_enabled(self) -> bool:
        from app.services.app_settings_service import load_app_settings_for_db_readonly
        return load_app_settings_for_db_readonly(self.db).general.ceph_admin_enabled

    def _ensure_unique_name(self, name: str, exclude_id: Optional[int] = None) -> None:
        statement = select(StorageEndpoint.id).where(StorageEndpoint.name == name)
        if exclude_id:
            statement = statement.where(StorageEndpoint.id != exclude_id)
        if self.db.scalar(statement.limit(1)) is not None:
            raise ValueError("An endpoint with this name already exists.")

    def _ensure_unique_endpoint(self, endpoint_url: str, exclude_id: Optional[int] = None) -> None:
        statement = select(StorageEndpoint.id).where(StorageEndpoint.endpoint_url == endpoint_url)
        if exclude_id:
            statement = statement.where(StorageEndpoint.id != exclude_id)
        if self.db.scalar(statement.limit(1)) is not None:
            raise ValueError("An endpoint with this URL already exists.")

    def detect_features(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> StorageEndpointFeatureDetectionResult:
        return StorageEndpointFeatureDetector(
            self.db,
            get_rgw_admin_client,
        ).detect(payload)

    @staticmethod
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

    @classmethod
    def _apply_endpoint_state(
        cls,
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
    ) -> None:
        old_target = cls._endpoint_target(endpoint) if endpoint.provider else None
        cls._apply_endpoint_fields(endpoint, config)
        if config.provider == StorageProvider.CEPH:
            cls._apply_ceph_service_identities(endpoint, config)
        endpoint.features_config = config.features_config
        if old_target != cls._endpoint_target(endpoint):
            cls._invalidate_external_service_identities(endpoint)
    @staticmethod
    def _endpoint_target(endpoint: StorageEndpoint) -> tuple[str, str, str | None]:
        return (
            endpoint.endpoint_url,
            resolve_rgw_admin_api_endpoint(endpoint),
            endpoint.region,
        )

    @staticmethod
    def _apply_endpoint_fields(
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
    ) -> None:
        endpoint.name = config.name
        endpoint.endpoint_url = config.endpoint_url
        endpoint.region = config.region
        endpoint.force_path_style = config.force_path_style
        endpoint.verify_tls = config.verify_tls
        endpoint.latitude = config.latitude
        endpoint.longitude = config.longitude
        endpoint.provider = config.provider.value
        endpoint.admin_access_key = config.admin_access_key
        endpoint.admin_secret_key = config.admin_secret_key
        if config.ceph_admin_allowed is not None:
            endpoint.ceph_admin_allowed = config.ceph_admin_allowed

    @classmethod
    def _apply_ceph_service_identities(
        cls,
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
    ) -> None:
        runtime = endpoint.service_identity("runtime")
        identity_mode = config.service_identity_mode or (
            runtime.mode if runtime is not None else "managed"
        )
        runtime = cls._ensure_service_identity(endpoint, "runtime", identity_mode)
        if runtime.mode == "external":
            cls._apply_external_credentials(
                runtime,
                config.runtime_access_key,
                config.runtime_secret_key,
            )

        supervision = cls._ensure_service_identity(endpoint, "supervision", runtime.mode)
        if supervision.mode == "external":
            cls._apply_external_credentials(
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
            cls._apply_external_credentials(
                ceph_admin,
                config.ceph_admin_access_key,
                config.ceph_admin_secret_key,
            )

    @classmethod
    def _ensure_service_identity(
        cls,
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
        cls._set_service_identity_mode(identity, mode)
        return identity

    @staticmethod
    def _invalidate_external_service_identities(endpoint: StorageEndpoint) -> None:
        for identity in endpoint.service_identities:
            if identity.mode == "external":
                identity.status = "missing"
                identity.last_error = None
                identity.last_reconciled_at = None

    @staticmethod
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

    @classmethod
    def _apply_env_endpoint(
        cls,
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
    ) -> None:
        cls._apply_endpoint_state(endpoint, config)
        endpoint.is_default = config.is_default
        endpoint.is_editable = False

    def _upsert_env_endpoint(
        self,
        config: NormalizedEndpointState,
        existing_by_url: dict[str, StorageEndpoint],
    ) -> StorageEndpoint:
        endpoint = self._resolve_env_endpoint(config, existing_by_url)
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        from app.core.runtime_surfaces import endpoint_identity_management_enabled

        identities = EndpointServiceIdentityService(self.db, actor=self.actor)
        lease, handle = identities._lease(endpoint) if endpoint.id is not None else (None, None)
        try:
            required = required_service_identity_kinds(
                normalize_features_config(
                    config.provider,
                    config.features_config,
                    config.region,
                )
            )
            config = self._preserve_unused_env_external_credentials(
                endpoint,
                config,
                required,
            )
            identity_management_enabled = endpoint_identity_management_enabled(settings)
            self._prepare_env_identity_transition(
                endpoint,
                config,
                required,
                identities,
                identity_management_enabled=identity_management_enabled,
            )
            self._apply_env_endpoint(endpoint, config)
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

    def _resolve_env_endpoint(
        self,
        config: NormalizedEndpointState,
        existing_by_url: dict[str, StorageEndpoint],
    ) -> StorageEndpoint:
        endpoint = existing_by_url.get(config.endpoint_url)
        if endpoint is not None:
            self._ensure_unique_name(config.name, exclude_id=endpoint.id)
            return endpoint

        self._ensure_unique_name(config.name)
        self._ensure_unique_endpoint(config.endpoint_url)
        endpoint = StorageEndpoint(name=config.name, endpoint_url=config.endpoint_url)
        existing_by_url[config.endpoint_url] = endpoint
        return endpoint

    @staticmethod
    def _preserve_unused_env_external_credentials(
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
    def _has_configured_env_service_identity(endpoint: StorageEndpoint) -> bool:
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

    def _prepare_env_identity_transition(
        self,
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        required: set[str],
        identities,
        *,
        identity_management_enabled: bool,
    ) -> None:
        self._validate_env_external_to_managed_transition(
            endpoint,
            config,
            required,
            identities,
            identity_management_enabled=identity_management_enabled,
        )
        if endpoint.id is None:
            return
        if self._revoke_env_identities_for_provider_change(
            endpoint,
            config,
            identities,
            identity_management_enabled=identity_management_enabled,
        ):
            return
        self._prepare_env_managed_to_external_transition(
            endpoint,
            config,
            required,
            identities,
            identity_management_enabled=identity_management_enabled,
        )

    def _validate_env_external_to_managed_transition(
        self,
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        required: set[str],
        identities,
        *,
        identity_management_enabled: bool,
    ) -> None:
        runtime = endpoint.service_identity("runtime")
        configured_services = self._has_configured_env_service_identity(endpoint)
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
    def _revoke_env_identities_for_provider_change(
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        identities,
        *,
        identity_management_enabled: bool,
    ) -> bool:
        if config.provider != StorageProvider.CEPH and identity_management_enabled:
            for kind in ("runtime", "supervision", "ceph_admin"):
                if not identities.revoke(endpoint, kind):
                    raise ValueError(
                        "Managed identity revocation is pending; retry before changing the ENV provider."
                    )
            return True
        return False

    @staticmethod
    def _prepare_env_managed_to_external_transition(
        endpoint: StorageEndpoint,
        config: NormalizedEndpointState,
        required: set[str],
        identities,
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
                    "ENV conversion to external mode requires replacement service credentials."
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

    def _clear_other_default_endpoints(self, default_url: str) -> None:
        endpoints = self.db.scalars(
            select(StorageEndpoint).where(StorageEndpoint.endpoint_url != default_url)
        )
        for endpoint in endpoints:
            if endpoint.is_default:
                endpoint.is_default = False
                self.db.add(endpoint)

    def _serialize_env_endpoints(
        self,
        configs: list[NormalizedEndpointState],
    ) -> list[StorageEndpointSchema]:
        synced: list[StorageEndpointSchema] = []
        for config in configs:
            endpoint = self.db.scalar(
                select(StorageEndpoint)
                .where(StorageEndpoint.endpoint_url == config.endpoint_url)
                .limit(1)
            )
            if endpoint is not None:
                synced.append(
                    self._serialize(endpoint, include_admin_ops_permissions=False)
                )
        return synced

    def sync_env_endpoints(self, *, _retry_on_integrity: bool = True) -> list[StorageEndpointSchema]:
        # Validate the whole inventory before any write, even when another instance
        # currently holds the synchronization lease.
        configs = normalize_env_storage_endpoint_states(
            parse_env_storage_endpoints(settings.env_storage_endpoints)
        )
        if not configs:
            env_locked_endpoints = self.db.scalars(
                select(StorageEndpoint).where(StorageEndpoint.is_editable.is_(False))
            ).all()
            for endpoint in env_locked_endpoints:
                endpoint.is_editable = True
                self.db.add(endpoint)
            if env_locked_endpoints:
                self.db.commit()
            return []
        from app.services.operation_lease_service import OperationLeaseService
        lease = OperationLeaseService(self.db)
        handle = lease.acquire("endpoints:env-sync", ttl_seconds=7200)
        if handle is None:
            return self.list_endpoints()
        try:
            return self._sync_env_endpoints(configs, _retry_on_integrity=_retry_on_integrity)
        finally:
            lease.release(handle)

    def _sync_env_endpoints(
        self,
        configs: list[NormalizedEndpointState],
        *,
        _retry_on_integrity: bool = True,
    ) -> list[StorageEndpointSchema]:
        existing_by_url = {
            endpoint.endpoint_url: endpoint
            for endpoint in self.db.scalars(select(StorageEndpoint)).all()
        }

        try:
            for config in configs:
                self._upsert_env_endpoint(config, existing_by_url)
            default_config = next(config for config in configs if config.is_default)
            self._clear_other_default_endpoints(default_config.endpoint_url)
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            if not _retry_on_integrity:
                raise
            logger.info("ENV_STORAGE_ENDPOINTS sync hit a concurrent insert; reloading existing endpoints.")
            return self._sync_env_endpoints(configs, _retry_on_integrity=False)
        return self._serialize_env_endpoints(configs)

    def reconcile_persisted_identities(self) -> None:
        from app.core.runtime_surfaces import endpoint_identity_management_enabled
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        if not endpoint_identity_management_enabled(settings):
            return
        identities = EndpointServiceIdentityService(self.db, actor=self.actor)
        for endpoint in self.db.scalars(
            select(StorageEndpoint).where(StorageEndpoint.provider == "ceph")
        ).all():
            if not identities.needs_startup_reconciliation(endpoint):
                continue
            try:
                identities.reconcile(endpoint)
            except ValueError:
                self.db.rollback()
                logger.info("Endpoint %s identity reconciliation deferred; retry from endpoint settings.", endpoint.id)

    def list_endpoints(self, *, include_admin_ops_permissions: bool = False) -> list[StorageEndpointSchema]:
        endpoints = self.db.scalars(
            select(StorageEndpoint).order_by(*name_order_by(StorageEndpoint))
        )
        return [self._serialize(ep, include_admin_ops_permissions=include_admin_ops_permissions) for ep in endpoints]

    def get_default_endpoint_url(self) -> Optional[str]:
        endpoint = self.db.scalar(
            select(StorageEndpoint)
            .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.name.asc())
            .limit(1)
        )
        if endpoint:
            return endpoint.endpoint_url
        return configured_s3_endpoint()

    def get_default_endpoint_record(self) -> Optional[StorageEndpoint]:
        return self.db.scalar(
            select(StorageEndpoint)
            .where(StorageEndpoint.is_default.is_(True))
            .order_by(StorageEndpoint.id.asc())
            .limit(1)
        )

    def find_endpoint_record_by_url(self, endpoint_url: str) -> Optional[StorageEndpoint]:
        return self.db.scalar(
            select(StorageEndpoint)
            .where(StorageEndpoint.endpoint_url == endpoint_url)
            .limit(1)
        )

    def get_endpoint_record(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if not endpoint:
            raise StorageEndpointNotFoundError("Endpoint not found.")
        return endpoint

    def get_endpoint(self, endpoint_id: int, *, include_admin_ops_permissions: bool = True) -> StorageEndpointSchema:
        endpoint = self.get_endpoint_record(endpoint_id)
        return self._serialize(endpoint, include_admin_ops_permissions=include_admin_ops_permissions)

    def update_endpoint_tags(self, endpoint_id: int, payload: StorageEndpointTagsUpdate) -> StorageEndpointSchema:
        endpoint = self.get_endpoint_record(endpoint_id)
        self.tags.replace_storage_endpoint_tags(endpoint, payload.tags)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def _persist_endpoint(self, endpoint: StorageEndpoint, *, commit: bool = True) -> StorageEndpointSchema:
        self.db.add(endpoint)
        if commit:
            self.db.commit()
            self.db.refresh(endpoint)
        else:
            self.db.flush()
        return self._serialize(endpoint)

    def create_endpoint(self, payload: StorageEndpointCreate) -> StorageEndpointSchema:
        self._ensure_env_editable()
        state = normalize_storage_endpoint_state(payload)
        self._ensure_unique_name(state.name)
        self._ensure_unique_endpoint(state.endpoint_url)
        endpoint = StorageEndpoint(name=state.name, endpoint_url=state.endpoint_url)
        self._apply_endpoint_state(endpoint, state)
        endpoint.is_default = False
        endpoint.is_editable = True
        # Durable endpoint IDs are required before any remote validation or provisioning.
        self._persist_endpoint(endpoint, commit=True)
        if endpoint.provider == "ceph":
            from app.services.endpoint_service_identities import EndpointServiceIdentityService
            EndpointServiceIdentityService(self.db, actor=self.actor).reconcile(
                endpoint,
                provision_unprovisioned=False,
            )
        return self._serialize(endpoint)

    def update_endpoint(self, endpoint_id: int, payload: StorageEndpointUpdate) -> StorageEndpointSchema:
        self._ensure_env_editable()
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if not endpoint:
            raise StorageEndpointNotFoundError("Endpoint not found.")
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be edited.")
        state = normalize_storage_endpoint_update(endpoint, payload)
        self._ensure_unique_name(state.name, exclude_id=endpoint.id)
        self._ensure_unique_endpoint(state.endpoint_url, exclude_id=endpoint.id)
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        identities = EndpointServiceIdentityService(self.db, actor=self.actor)
        lease, handle = identities._lease(endpoint)
        try:
            state = normalize_storage_endpoint_update(endpoint, payload)
            if state.service_identity_mode == "external" or state.provider != StorageProvider.CEPH:
                for kind in ("runtime", "supervision"):
                    identity = endpoint.service_identity(kind)
                    if identity is not None and identity.mode == "managed":
                        if not identities.revoke(endpoint, kind):
                            raise ValueError("Managed identity revocation is pending; retry before changing identity mode.")
                        identity.mode = "external"
            if state.provider != StorageProvider.CEPH and not identities.revoke(endpoint, "ceph_admin"):
                raise ValueError("Ceph Admin revocation is pending; retry before changing provider.")
            self._apply_endpoint_state(endpoint, state)
            self._persist_endpoint(endpoint)
            if endpoint.provider == "ceph":
                identities.reconcile(
                    endpoint,
                    locked=True,
                    provision_unprovisioned=False,
                )
        finally:
            lease.release(handle)
        return self._serialize(endpoint)

    def reconcile_identities(self, endpoint_id: int) -> StorageEndpointSchema:
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if endpoint is None:
            raise StorageEndpointNotFoundError("Endpoint not found.")
        EndpointServiceIdentityService(self.db, actor=self.actor).reconcile(
            endpoint,
            provision_unprovisioned=True,
        )
        return self._serialize(endpoint)

    def delete_endpoint(self, endpoint_id: int) -> None:
        self._ensure_env_editable()
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if not endpoint:
            raise StorageEndpointNotFoundError("Endpoint not found.")
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be deleted.")
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        identities = EndpointServiceIdentityService(self.db, actor=self.actor)
        lease, handle = identities._lease(endpoint)
        try:
            # _lease refreshes the target; all checks and the deletion commit stay locked.
            if not endpoint.is_editable:
                raise ValueError("This endpoint is protected and cannot be deleted.")
            linked_accounts = self.db.scalar(
                select(func.count()).select_from(S3Account).where(S3Account.storage_endpoint_id == endpoint.id)
            )
            linked_users = self.db.scalar(
                select(func.count()).select_from(S3User).where(S3User.storage_endpoint_id == endpoint.id)
            )
            linked_connections = self.db.scalar(
                select(func.count()).select_from(S3Connection).where(S3Connection.storage_endpoint_id == endpoint.id)
            )
            if any((linked_accounts, linked_users, linked_connections)):
                raise ValueError(f"Unable to delete this endpoint: accounts={linked_accounts}, users={linked_users}, connections={linked_connections}.")
            if any(intent.key_type not in ("endpoint_runtime", "endpoint_supervision", "ceph_admin") for intent in endpoint.key_rotation_intents):
                raise ValueError("Finish pending key rotations before deleting the endpoint.")
            for kind in ("runtime", "supervision", "ceph_admin"):
                if not identities.revoke(endpoint, kind):
                    raise ValueError("Managed identity revocation is pending; retry before deleting the endpoint.")
            ResourceDeletionPurgeService(self.db).purge_endpoint_derived_data(endpoint.id)
            self.db.delete(endpoint)
            self.db.flush()
            self.tags.cleanup_orphan_definitions(domain_kinds=[TAG_DOMAIN_ENDPOINT, TAG_DOMAIN_BUCKET_UI_CEPH_ADMIN, TAG_DOMAIN_BUCKET_UI_STORAGE_OPS])
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        finally:
            lease.release(handle)

    def set_default_endpoint(self, endpoint_id: int) -> StorageEndpointSchema:
        self._ensure_env_editable()
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if not endpoint:
            raise StorageEndpointNotFoundError("Endpoint not found.")
        if endpoint.is_default:
            return self._serialize(endpoint)
        self.db.execute(
            update(StorageEndpoint)
            .where(StorageEndpoint.is_default.is_(True), StorageEndpoint.id != endpoint.id)
            .values(is_default=False)
            .execution_options(synchronize_session=False)
        )
        endpoint.is_default = True
        self.db.add(endpoint)
        self.db.commit()
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def _env_endpoint_name(self) -> str:
        candidate = "Default"
        if self.db.scalar(
            select(StorageEndpoint.id).where(StorageEndpoint.name == candidate).limit(1)
        ) is None:
            return candidate
        suffix = self.db.scalar(select(func.count()).select_from(StorageEndpoint)) + 1
        return f"{candidate}-{suffix}"

    def ensure_default_endpoint(self) -> Optional[StorageEndpointSchema]:
        if self.env_endpoints_locked():
            self.sync_env_endpoints()
            return None
        endpoint_url = configured_s3_endpoint()
        if not endpoint_url:
            return None
        if self.db.scalar(select(func.count()).select_from(StorageEndpoint)) > 0:
            return None
        admin_access = settings.seed_rgw_admin_access_key or settings.seed_s3_access_key
        admin_secret = settings.seed_rgw_admin_secret_key or settings.seed_s3_secret_key
        supervision_access = settings.seed_supervision_access_key
        supervision_secret = settings.seed_supervision_secret_key
        provider = (
            StorageProvider.CEPH if admin_access and admin_secret else StorageProvider.OTHER
        )
        state = normalize_storage_endpoint_state(
            StorageEndpointCreate(
                name=self._env_endpoint_name(),
                endpoint_url=endpoint_url,
                region=settings.seed_s3_region,
                force_path_style=False,
                verify_tls=True,
                provider=provider,
                admin_access_key=admin_access,
                admin_secret_key=admin_secret,
                service_identity_mode=settings.seed_service_identity_mode,
                runtime_access_key=settings.seed_runtime_access_key,
                runtime_secret_key=settings.seed_runtime_secret_key,
                supervision_access_key=supervision_access,
                supervision_secret_key=supervision_secret,
                features_config=settings.seed_s3_endpoint_features,
            )
        )
        entry = StorageEndpoint(
            name=state.name,
            endpoint_url=state.endpoint_url,
            is_default=True,
            is_editable=True,
        )
        self._apply_endpoint_state(entry, state)
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)
        from app.core.runtime_surfaces import endpoint_identity_management_enabled
        if endpoint_identity_management_enabled(settings) and entry.admin_access_key and entry.admin_secret_key:
            self.reconcile_identities(entry.id)
        return self._serialize(entry)


def get_storage_endpoints_service(
    db: Session,
    *,
    actor: User | None = None,
) -> StorageEndpointsService:
    return StorageEndpointsService(db, actor=actor)
