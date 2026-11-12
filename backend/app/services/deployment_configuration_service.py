# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from contextlib import ExitStack
from dataclasses import dataclass, replace
from hashlib import sha256
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.db import AppSetting, AuditLog, StorageEndpoint
from app.models.deployment_configuration import DeploymentManifest
from app.services.app_settings_service import (
    APP_SETTINGS_DB_KEY,
    load_app_settings_for_db,
)
from app.services.deployment_configuration_state import (
    get_deployment_configuration,
    lock_deployment_configuration,
    deployment_configuration_operation,
)
from app.services.endpoint_service_identities import INSTALLATION_KEY, EndpointServiceIdentityService
from app.services.endpoint_service_identity_reconciliation_policy import needs_startup_reconciliation
from app.services.rgw_admin import get_rgw_admin_client
from app.services.storage_endpoint_normalization import (
    NormalizedEndpointState,
    normalize_storage_endpoint_definitions,
)
from app.services.storage_endpoint_state import apply_storage_endpoint_state
from app.utils.storage_endpoint_features import required_service_identity_kinds, resolve_rgw_admin_api_endpoint
from app.utils.time import utcnow

@dataclass(frozen=True)
class ApplyResult:
    revision: int
    changed: bool
    pending_endpoints: tuple[str, ...]


@dataclass(frozen=True)
class EndpointChange:
    key: str
    endpoint_id: int | None
    config: NormalizedEndpointState


@dataclass(frozen=True)
class ManagedIdentityProof:
    uid: str
    access_key: str


def _revision_already_applied(state, revision: int, digest: str) -> bool:
    if state is None or revision > state.revision:
        return False
    if revision == state.revision and digest == state.manifest_digest:
        return True
    raise ValueError("The deployment revision is stale or was used with a different manifest.")


def _target(endpoint):
    return endpoint.endpoint_url, resolve_rgw_admin_api_endpoint(endpoint), endpoint.region


def _with_unused_external_credentials(endpoint: StorageEndpoint, config: NormalizedEndpointState):
    if config.service_identity_mode != "external":
        return config
    required = required_service_identity_kinds(config.features)
    credentials = {}
    for kind in ("runtime", "supervision"):
        identity = endpoint.service_identity(kind)
        if kind not in required and identity is not None and identity.mode == "external" and not getattr(config, f"{kind}_access_key"):
            credentials.update({
                f"{kind}_access_key": identity.access_key,
                f"{kind}_secret_key": identity.secret_key,
            })
    return replace(config, **credentials)


class DeploymentConfigurationService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.identities = EndpointServiceIdentityService(db)

    def apply(self, manifest: DeploymentManifest) -> ApplyResult:
        canonical = json.dumps(
            manifest.model_dump(mode="json", exclude_unset=True), sort_keys=True, separators=(",", ":")
        )
        digest = sha256(canonical.encode()).hexdigest()
        with deployment_configuration_operation(self.db):
            state = get_deployment_configuration(self.db)
            if _revision_already_applied(state, manifest.revision, digest):
                keys = tuple(entry.key for entry in (manifest.storage_endpoints or []))
                pending = self._reconcile(keys)
                return ApplyResult(manifest.revision, False, pending)
            return self._apply_new_revision(manifest, digest)

    def _apply_new_revision(self, manifest: DeploymentManifest, digest: str) -> ApplyResult:
        entries = manifest.storage_endpoints
        configs = normalize_storage_endpoint_definitions(
            [entry.resolve_credentials() for entry in entries]
        ) if entries is not None else []
        keys = tuple(entry.key for entry in entries or [])
        with ExitStack() as endpoint_leases:
            if entries is not None:
                changes = self._plan_inventory(self.db, keys, configs)
                for endpoint_id in sorted(change.endpoint_id for change in changes if change.endpoint_id is not None):
                    endpoint = self.db.get(StorageEndpoint, endpoint_id)
                    lease, handle = self.identities.lease(endpoint)
                    endpoint_leases.callback(lease.release, handle)
                changes = self._plan_inventory(self.db, keys, configs)
                self._verify_changed_targets(changes)

            def publish(write_db: Session) -> None:
                state = lock_deployment_configuration(write_db)
                if _revision_already_applied(state, manifest.revision, digest):
                    return
                if entries is not None:
                    for change in self._plan_inventory(write_db, keys, configs):
                        self._write_endpoint(write_db, change)
                    state.storage_endpoints_managed = True
                elif "storage_endpoints" in manifest.model_fields_set:
                    for endpoint in write_db.scalars(select(StorageEndpoint)):
                        endpoint.is_editable = True
                    state.storage_endpoints_managed = False

                if manifest.features:
                    app_settings = load_app_settings_for_db(write_db)
                    locked = set(state.locked_features)
                    for name, value in manifest.features.items():
                        if value is None:
                            locked.discard(name)
                        else:
                            locked.add(name)
                            setattr(app_settings.general, name, value)
                    row = write_db.get(AppSetting, APP_SETTINGS_DB_KEY)
                    row.payload = app_settings.model_dump(mode="json")
                    row.updated_at = utcnow()
                    state.locked_features = sorted(locked)

                state.revision = manifest.revision
                state.manifest_digest = digest
                write_db.add(AuditLog(
                    user_email="deployment",
                    user_role="system",
                    scope="admin",
                    action="deployment_configuration.apply",
                    entity_type="deployment_configuration",
                    entity_id=str(manifest.revision),
                    audit_metadata={
                        "revision": manifest.revision,
                        "feature_fields": sorted(manifest.features),
                        "storage_endpoints_managed": state.storage_endpoints_managed,
                        "endpoint_keys": list(keys),
                    },
                ))

            run_replayable_db_unit(self.db, publish)

        pending = self._reconcile(keys)
        return ApplyResult(manifest.revision, True, pending)

    @staticmethod
    def _plan_inventory(db: Session, keys, configs) -> list[EndpointChange]:
        existing = db.scalars(select(StorageEndpoint)).all()
        by_key = {endpoint.deployment_key: endpoint for endpoint in existing if endpoint.deployment_key}
        by_url = {endpoint.endpoint_url: endpoint for endpoint in existing}
        by_name = {endpoint.name: endpoint for endpoint in existing}
        adopted = set()
        changes = []
        for key, config in zip(keys, configs, strict=True):
            endpoint = by_key.get(key)
            at_url = by_url.get(config.endpoint_url)
            if endpoint is None and at_url is not None and at_url.deployment_key is None:
                endpoint = at_url
            at_name = by_name.get(config.name)
            if (at_url is not None and at_url is not endpoint) or (at_name is not None and at_name is not endpoint):
                raise ValueError(f"Endpoint {key} conflicts with an existing endpoint.")
            if endpoint is not None:
                if endpoint.id in adopted:
                    raise ValueError(f"Endpoint {key} resolves to an already matched endpoint.")
                runtime = endpoint.service_identity("runtime")
                if endpoint.provider != config.provider or (runtime is not None and runtime.mode != config.service_identity_mode):
                    raise ValueError(f"Change the provider or identity mode for {key} in Admin before applying.")
                if any(identity.status == "revocation_pending" for identity in endpoint.service_identities):
                    raise ValueError(f"Complete the pending identity revocation for {key} before applying.")
                if endpoint.key_rotation_intents:
                    raise ValueError(f"Complete the pending key rotation for {key} before applying.")
                adopted.add(endpoint.id)
                config = _with_unused_external_credentials(endpoint, config)
            changes.append(EndpointChange(key, endpoint.id if endpoint is not None else None, config))
        if len(adopted) != len(existing):
            raise ValueError("The deployment manifest must cover the existing storage endpoint inventory.")
        return changes

    def _verify_changed_targets(self, changes: list[EndpointChange]) -> None:
        installation = self.db.get(AppSetting, INSTALLATION_KEY)
        installation_id = installation.payload if installation is not None else None
        checks = []
        for change in changes:
            if change.endpoint_id is None:
                continue
            endpoint = self.db.get(StorageEndpoint, change.endpoint_id)
            config = change.config
            if _target(endpoint) == _target(config):
                continue
            proofs = []
            for identity in endpoint.service_identities:
                if identity.mode != "managed" or identity.status in ("disabled", "not_provisioned"):
                    continue
                if (
                    not isinstance(installation_id, str)
                    or not installation_id
                    or not identity.rgw_uid
                    or not identity.access_key
                    or identity.provenance != f"{installation_id}:{endpoint.identity_namespace}"
                ):
                    raise ValueError(f"Cannot prove the ownership of existing identities for {change.key}.")
                proofs.append(ManagedIdentityProof(identity.rgw_uid, identity.access_key))
            if proofs:
                checks.append((change.key, config, proofs))
        self.db.rollback()

        for key, config, proofs in checks:
            client = get_rgw_admin_client(
                access_key=config.admin_access_key,
                secret_key=config.admin_secret_key,
                endpoint=resolve_rgw_admin_api_endpoint(config),
                region=config.region,
                verify_tls=config.verify_tls,
            )
            for proof in proofs:
                payload = client.get_user(proof.uid, allow_not_found=True)
                if not self.identities.validation.owns(proof, payload):
                    raise ValueError(f"The proposed target for {key} does not have the existing managed identity.")

    @staticmethod
    def _write_endpoint(db: Session, change: EndpointChange) -> None:
        config = change.config
        if change.endpoint_id is None:
            endpoint = StorageEndpoint(name=config.name, endpoint_url=config.endpoint_url)
            db.add(endpoint)
        else:
            endpoint = db.get(StorageEndpoint, change.endpoint_id)
            admin_credentials_changed = (
                endpoint.admin_access_key != config.admin_access_key
                or endpoint.admin_secret_key != config.admin_secret_key
            )
            if _target(endpoint) != _target(config) or admin_credentials_changed:
                for identity in endpoint.service_identities:
                    if identity.status == "ready":
                        identity.status = "missing"
        apply_storage_endpoint_state(endpoint, config)
        endpoint.deployment_key = change.key
        endpoint.is_default = config.is_default
        endpoint.is_editable = False

    def _reconcile(self, keys: tuple[str, ...]) -> tuple[str, ...]:
        pending = []
        for key in keys:
            endpoint = self.db.scalar(select(StorageEndpoint).where(StorageEndpoint.deployment_key == key))
            if endpoint is None or not needs_startup_reconciliation(endpoint, provision_unprovisioned=True):
                continue
            try:
                self.identities.reconcile(endpoint, provision_unprovisioned=True)
            except (ValueError, RuntimeError):
                self.db.rollback()
            endpoint = self.db.scalar(
                select(StorageEndpoint).where(StorageEndpoint.deployment_key == key).execution_options(populate_existing=True)
            )
            if endpoint is not None and needs_startup_reconciliation(endpoint, provision_unprovisioned=True):
                pending.append(key)
        self.db.rollback()
        return tuple(pending)
