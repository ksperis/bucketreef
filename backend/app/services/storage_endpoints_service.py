# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import logging
from typing import Optional

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db_transactions import commit_or_rollback
from app.core.domain_enums import (
    MANAGED_SERVICE_IDENTITY_KINDS,
    SERVICE_IDENTITY_KINDS,
    StorageProvider,
)
from app.core.domain_errors import StorageEndpointNotFoundError
from app.db import S3Account, S3Connection, S3User, StorageEndpoint, User
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
from app.services.endpoint_service_identity_reconciliation_policy import (
    needs_startup_reconciliation,
)
from app.services.storage_endpoint_env_sync import StorageEndpointEnvSyncService
from app.services.storage_endpoint_normalization import (
    normalize_storage_endpoint_state,
    normalize_storage_endpoint_update,
)
from app.services.storage_endpoint_state import apply_storage_endpoint_state
from app.services.storage_endpoint_uniqueness import (
    ensure_unique_storage_endpoint_name,
    ensure_unique_storage_endpoint_url,
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
    normalize_seed_features_config,
    validate_persisted_features,
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

    def _resolve_actor(self, actor: User | None) -> User | None:
        return actor if actor is not None else self.actor

    def _serialize(
        self,
        endpoint: StorageEndpoint,
        *,
        include_admin_ops_permissions: bool = True,
    ) -> StorageEndpointSchema:
        provider = StorageProvider(endpoint.provider)
        features = validate_persisted_features(
            provider,
            endpoint.features,
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
        from app.services.app_settings_service import load_app_settings_for_db
        return load_app_settings_for_db(self.db).general.ceph_admin_enabled

    def detect_features(
        self,
        payload: StorageEndpointFeatureDetectionRequest,
    ) -> StorageEndpointFeatureDetectionResult:
        return StorageEndpointFeatureDetector(
            self.db,
            get_rgw_admin_client,
        ).detect(payload)

    def sync_env_endpoints(self) -> list[StorageEndpointSchema]:
        synced = StorageEndpointEnvSyncService(
            self.db,
            actor=self.actor,
        ).sync()
        if synced is None:
            return self.list_endpoints()
        return [
            self._serialize(endpoint, include_admin_ops_permissions=False)
            for endpoint in synced
        ]

    def reconcile_persisted_identities(self) -> None:
        from app.core.runtime_surfaces import endpoint_identity_management_enabled
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        if not endpoint_identity_management_enabled(settings):
            return
        identities = EndpointServiceIdentityService(self.db, actor=self.actor)
        for endpoint in self.db.scalars(
            select(StorageEndpoint).where(StorageEndpoint.provider == "ceph")
        ).all():
            if not needs_startup_reconciliation(endpoint):
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
        commit_or_rollback(self.db)
        self.db.refresh(endpoint)
        return self._serialize(endpoint)

    def _commit_endpoint(self, endpoint: StorageEndpoint) -> None:
        self.db.add(endpoint)
        commit_or_rollback(self.db)
        self.db.refresh(endpoint)

    def create_endpoint(
        self,
        payload: StorageEndpointCreate,
        *,
        actor: User | None = None,
    ) -> StorageEndpointSchema:
        self._ensure_env_editable()
        state = normalize_storage_endpoint_state(payload)
        ensure_unique_storage_endpoint_name(self.db, state.name)
        ensure_unique_storage_endpoint_url(self.db, state.endpoint_url)
        endpoint = StorageEndpoint(name=state.name, endpoint_url=state.endpoint_url)
        apply_storage_endpoint_state(endpoint, state)
        endpoint.is_default = False
        endpoint.is_editable = True
        # Durable endpoint IDs are required before any remote validation or provisioning.
        self._commit_endpoint(endpoint)
        if endpoint.provider == "ceph":
            from app.services.endpoint_service_identities import EndpointServiceIdentityService
            EndpointServiceIdentityService(
                self.db,
                actor=self._resolve_actor(actor),
            ).reconcile(
                endpoint,
                provision_unprovisioned=False,
            )
        return self._serialize(endpoint)

    def update_endpoint(
        self,
        endpoint_id: int,
        payload: StorageEndpointUpdate,
        *,
        actor: User | None = None,
    ) -> StorageEndpointSchema:
        self._ensure_env_editable()
        endpoint = self.get_endpoint_record(endpoint_id)
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be edited.")
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        identities = EndpointServiceIdentityService(
            self.db,
            actor=self._resolve_actor(actor),
        )
        lease, handle = identities.lease(endpoint)
        try:
            # lease() refreshes the target; validation and mutation must use that locked state.
            if not endpoint.is_editable:
                raise ValueError("This endpoint is protected and cannot be edited.")
            state = normalize_storage_endpoint_update(endpoint, payload)
            ensure_unique_storage_endpoint_name(
                self.db,
                state.name,
                exclude_id=endpoint.id,
            )
            ensure_unique_storage_endpoint_url(
                self.db,
                state.endpoint_url,
                exclude_id=endpoint.id,
            )
            if state.service_identity_mode == "external" or state.provider != StorageProvider.CEPH:
                for kind in MANAGED_SERVICE_IDENTITY_KINDS:
                    identity = endpoint.service_identity(kind)
                    if identity is not None and identity.mode == "managed":
                        if not identities.revoke(endpoint, kind):
                            raise ValueError("Managed identity revocation is pending; retry before changing identity mode.")
                        identity.mode = "external"
            if state.provider != StorageProvider.CEPH and not identities.revoke(endpoint, "ceph_admin"):
                raise ValueError("Ceph Admin revocation is pending; retry before changing provider.")
            apply_storage_endpoint_state(endpoint, state)
            self._commit_endpoint(endpoint)
            if endpoint.provider == "ceph":
                identities.reconcile(
                    endpoint,
                    locked=True,
                    provision_unprovisioned=False,
                )
        finally:
            lease.release(handle)
        return self._serialize(endpoint)

    def reconcile_identities(
        self,
        endpoint_id: int,
        *,
        actor: User | None = None,
    ) -> StorageEndpointSchema:
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        endpoint = self.get_endpoint_record(endpoint_id)
        EndpointServiceIdentityService(
            self.db,
            actor=self._resolve_actor(actor),
        ).reconcile(
            endpoint,
            provision_unprovisioned=True,
        )
        return self._serialize(endpoint)

    def delete_endpoint(self, endpoint_id: int) -> None:
        self._ensure_env_editable()
        endpoint = self.get_endpoint_record(endpoint_id)
        if not endpoint.is_editable:
            raise ValueError("This endpoint is protected and cannot be deleted.")
        from app.services.endpoint_service_identities import EndpointServiceIdentityService
        identities = EndpointServiceIdentityService(self.db, actor=self.actor)
        lease, handle = identities.lease(endpoint)
        try:
            # lease() refreshes the target; all checks and the deletion commit stay locked.
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
            for kind in SERVICE_IDENTITY_KINDS:
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
        endpoint = self.get_endpoint_record(endpoint_id)
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
        commit_or_rollback(self.db)
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
                features=(
                    normalize_seed_features_config(
                        provider,
                        settings.seed_s3_endpoint_features,
                        settings.seed_s3_region,
                    )
                    if settings.seed_s3_endpoint_features
                    else None
                ),
            )
        )
        entry = StorageEndpoint(
            name=state.name,
            endpoint_url=state.endpoint_url,
            is_default=True,
            is_editable=True,
        )
        apply_storage_endpoint_state(entry, state)
        self.db.add(entry)
        commit_or_rollback(self.db)
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
