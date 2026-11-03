# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Provision, reconcile and revoke endpoint identities with durable ownership proof."""
from __future__ import annotations

import secrets
from collections.abc import Callable
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.core.sqlite import ensure_sqlite_transaction_for_savepoint
from app.db import AppSetting, EndpointServiceIdentity, StorageEndpoint, User
from app.models.storage_endpoint import StorageEndpointAdminOpsPermissions
from app.services.audit_service import AuditService
from app.services.endpoint_service_identity_validation import (
    SERVICE_CAPS,
    EndpointServiceIdentityValidationService,
    ManagedIdentityKeyDriftError,
    ManagedServiceIdentityKind,
    ServiceIdentityKind,
)
from app.services.endpoint_service_identity_reconciliation_policy import (
    desired_service_kinds,
    skip_unprovisioned_identity,
)
from app.services.operation_lease_service import OperationLeaseHandle, OperationLeaseService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_admin_identity import classify_rgw_credential_failure
from app.services.rgw_endpoint_clients import get_endpoint_bootstrap_rgw_client
from app.services.storage_endpoint_admin_permissions import admin_ops_permissions_from_caps
from app.utils.rgw_payloads import extract_rgw_user_caps, extract_rgw_user_identity, rgw_qualified_uid
from app.utils.time import utcnow

INSTALLATION_KEY = "endpoint-service-identity-installation"
EndpointClientFactory = Callable[[StorageEndpoint], RGWAdminClient]


class EndpointServiceIdentityService:
    def __init__(
        self,
        db: Session,
        *,
        actor: User | None = None,
        client_factory: EndpointClientFactory | None = None,
    ) -> None:
        self.db = db
        self.actor = actor
        self.client_factory = client_factory or get_endpoint_bootstrap_rgw_client
        self.validation = EndpointServiceIdentityValidationService(db)

    def installation_id(self) -> str:
        row = self.db.get(AppSetting, INSTALLATION_KEY)
        if row is None:
            row = AppSetting(key=INSTALLATION_KEY, payload=uuid4().hex)
            try:
                ensure_sqlite_transaction_for_savepoint(self.db)
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                row = self.db.get(AppSetting, INSTALLATION_KEY)
        installation_id = row.payload
        if not isinstance(installation_id, str):
            raise ValueError("Service identity installation id is invalid.")
        return installation_id

    def _audit(
        self,
        endpoint: StorageEndpoint,
        identity: EndpointServiceIdentity,
        action: str,
    ) -> None:
        AuditService(self.db).record_action(
            user=self.actor, user_email="system" if self.actor is None else None,
            scope="admin", action=f"endpoint_service_identity.{action}",
            entity_type="storage_endpoint", entity_id=str(endpoint.id),
            metadata={"endpoint_id": endpoint.id, "kind": identity.kind, "uid": identity.rgw_uid,
                      "mode": identity.mode, "executor": identity.kind if action == "validated" else "admin_ops", "workflow": "endpoint-service-identities"},
        )

    def record_key_drift(
        self,
        endpoint: StorageEndpoint,
        identity: EndpointServiceIdentity,
        error: ManagedIdentityKeyDriftError,
    ) -> None:
        changed = identity.last_error != str(error)
        if identity.status != "revocation_pending":
            identity.status = "error"
        identity.last_error = str(error)
        identity.last_reconciled_at = utcnow()
        self.db.commit()
        if changed:
            self._audit(endpoint, identity, "key_drift_detected")

    def lease(
        self,
        endpoint: StorageEndpoint,
    ) -> tuple[OperationLeaseService, OperationLeaseHandle]:
        # The bound exceeds the configured RGW timeouts for this workflow.
        endpoint_id = endpoint.id
        lease = OperationLeaseService(self.db)
        handle = lease.acquire(f"endpoint-identities:{endpoint_id}", ttl_seconds=1800)
        if handle is None:
            raise ValueError("Service identity configuration is already running for this endpoint.")
        current = self.db.scalars(
            select(StorageEndpoint)
            .where(StorageEndpoint.id == endpoint_id)
            .execution_options(populate_existing=True)
            .limit(1)
        ).first()
        if current is None:
            lease.release(handle)
            raise ValueError("Endpoint no longer exists.")
        return lease, handle

    def admin_permissions(
        self,
        endpoint: StorageEndpoint,
    ) -> tuple[RGWAdminClient, StorageEndpointAdminOpsPermissions]:
        admin = self.client_factory(endpoint)
        payload = admin.get_user_by_access_key(endpoint.admin_access_key, allow_not_found=True)
        if not isinstance(payload, dict):
            raise ValueError("Admin Ops access key is not recognized by RGW.")
        permissions = admin_ops_permissions_from_caps(extract_rgw_user_caps(payload))
        if not permissions.users_read or not permissions.accounts_read:
            raise ValueError("Admin Ops requires users=read and accounts=read.")
        return admin, permissions

    def _managed_identity(
        self,
        endpoint: StorageEndpoint,
        kind: ManagedServiceIdentityKind,
        permissions: StorageEndpointAdminOpsPermissions,
    ) -> EndpointServiceIdentity:
        identity = endpoint.service_identity(kind)
        if identity is None:
            identity = EndpointServiceIdentity(kind=kind, mode="managed", status="missing")
            endpoint.service_identities.append(identity)
        if identity.mode != "managed":
            raise ValueError("Explicit conversion is required before provisioning a managed identity.")
        if identity.rgw_uid and identity.access_key:
            return identity
        if not permissions.users_write:
            raise ValueError("Managed service identities require Admin Ops users=write.")
        installation = self.installation_id()
        provenance = f"{installation}:{endpoint.identity_namespace}"
        if identity.provenance not in (None, provenance):
            raise ValueError("Service identity ownership does not match this installation.")
        identity.provenance = provenance
        identity.rgw_uid = (
            f"bkr-{installation[:12]}-{endpoint.identity_namespace[:12]}-"
            f"{kind.replace('_', '-')}"
        )
        identity.access_key = identity.access_key or secrets.token_hex(10).upper()
        identity.secret_key = identity.secret_key or secrets.token_urlsafe(32)
        identity.status = "provisioning"
        self.db.commit()
        return identity

    def _ensure_managed_remote_user(
        self,
        endpoint: StorageEndpoint,
        kind: ManagedServiceIdentityKind,
        identity: EndpointServiceIdentity,
        admin: RGWAdminClient,
        permissions: StorageEndpointAdminOpsPermissions,
    ) -> None:
        provenance = f"{self.installation_id()}:{endpoint.identity_namespace}"
        if identity.provenance != provenance:
            raise ValueError("Cannot validate a managed identity without ownership proof.")
        payload = admin.get_user(identity.rgw_uid, allow_not_found=True)
        if payload is not None and not self.validation.owns(identity, payload):
            raise ValueError("RGW service UID collision; the existing user will not be modified.")
        if payload is not None:
            self.validation.validate_managed_keys(identity, payload)
        created = payload is None
        if created:
            if not permissions.users_write:
                raise ValueError("Managed service identity is absent; recreation requires users=write.")
            identity.status = "provisioning"
            self.db.commit()
            payload = admin.create_user(
                identity.rgw_uid,
                display_name=f"BucketReef {kind} service",
                generate_key=False,
                access_key=identity.access_key,
                secret_key=identity.secret_key,
                extra_params={"max-buckets": 0},
            )
            if not self.validation.owns(identity, payload):
                raise ValueError("RGW did not confirm ownership of the new service identity.")
            self.validation.validate_managed_keys(identity, payload)
            self._audit(endpoint, identity, "created")
        # Only bootstrap an identity that has never passed validation. Do not
        # rewrite permissions or interrupt a previously operational identity.
        if (created or identity.last_reconciled_at is None) and permissions.users_write:
            admin.set_user_caps(identity.rgw_uid, SERVICE_CAPS[kind])

    @staticmethod
    def _external_identity(
        endpoint: StorageEndpoint,
        kind: ManagedServiceIdentityKind,
    ) -> EndpointServiceIdentity:
        identity = endpoint.service_identity(kind)
        if identity is None or not identity.access_key or not identity.secret_key:
            raise ValueError(f"Externally managed endpoints require complete {kind} credentials.")
        if identity.mode != "external":
            raise ValueError("Revoke the managed identity before supplying an external replacement.")
        return identity

    def _validate_service_identity(
        self,
        endpoint: StorageEndpoint,
        identity: EndpointServiceIdentity,
        kind: ManagedServiceIdentityKind,
        admin: RGWAdminClient,
        *,
        managed: bool,
    ) -> EndpointServiceIdentity:
        payload = admin.get_user_by_access_key(identity.access_key, allow_not_found=True)
        self.validation.validate_payload(kind, payload)
        if managed:
            self.validation.validate_managed_keys(identity, payload)
        uid, tenant = extract_rgw_user_identity(payload)
        if not uid:
            raise ValueError(f"{kind} user could not be identified by RGW.")
        identity.rgw_uid = rgw_qualified_uid(uid, tenant)
        self.validation.functional_check(
            endpoint,
            kind=identity.kind,
            rgw_uid=identity.rgw_uid,
            access_key=identity.access_key,
            secret_key=identity.secret_key,
        )
        identity.status, identity.last_error = "ready", None
        identity.last_reconciled_at = utcnow()
        self.db.commit()
        self._audit(endpoint, identity, "validated")
        return identity

    def _ensure(
        self,
        endpoint: StorageEndpoint,
        kind: ManagedServiceIdentityKind,
        admin: RGWAdminClient,
        permissions: StorageEndpointAdminOpsPermissions,
        *,
        managed: bool,
    ) -> EndpointServiceIdentity:
        if kind == "ceph_admin":
            raise ValueError("Ceph Admin credentials must be supplied manually.")
        if managed:
            identity = self._managed_identity(endpoint, kind, permissions)
            self._ensure_managed_remote_user(
                endpoint,
                kind,
                identity,
                admin,
                permissions,
            )
        else:
            identity = self._external_identity(endpoint, kind)
        return self._validate_service_identity(
            endpoint,
            identity,
            kind,
            admin,
            managed=managed,
        )

    def validate_ceph_admin(self, endpoint: StorageEndpoint) -> dict[str, str]:
        """Authenticate the supplied pair without using bootstrap credentials or RGW writes."""
        identity = endpoint.service_identity("ceph_admin")
        if identity is None:
            return {"kind": "ceph_admin", "status": "missing"}
        if not identity.access_key or not identity.secret_key:
            identity.status, identity.last_error = "missing", None
            identity.last_reconciled_at = None
        else:
            try:
                if identity.mode != "external":
                    raise ValueError("Ceph Admin credentials must be supplied manually.")
                from app.services.rgw_admin import get_rgw_admin_client
                from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
                client = get_rgw_admin_client(
                    access_key=identity.access_key, secret_key=identity.secret_key,
                    endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region,
                    verify_tls=endpoint.verify_tls,
                )
                payload = client.get_user_by_access_key(identity.access_key, allow_not_found=True)
                self.validation.validate_payload("ceph_admin", payload)
                uid, tenant = extract_rgw_user_identity(payload)
                if not uid:
                    raise ValueError("Ceph Admin user could not be identified by RGW.")
                identity.rgw_uid = rgw_qualified_uid(uid, tenant)
                identity.status, identity.last_error = "ready", None
                self._audit(endpoint, identity, "validated")
            except ValueError as exc:
                identity.status, identity.last_error = (
                    "error",
                    sanitized_error_log_detail(exc),
                )
            except RGWAdminError as exc:
                failure = classify_rgw_credential_failure(exc)
                identity.status = "error"
                identity.last_error = (
                    "Ceph Admin credentials were denied by RGW."
                    if failure == "denied" else
                    "Ceph Admin validation failed; check the RGW endpoint configuration and connectivity."
                )
            identity.last_reconciled_at = utcnow()
        self.db.commit()
        return {"kind": "ceph_admin", "status": identity.status}

    def revoke(self, endpoint: StorageEndpoint, kind: ServiceIdentityKind) -> bool:
        if kind == "ceph_admin":
            return True  # External principals and keys belong to the operator.
        identity = endpoint.service_identity(kind)
        if identity is None or identity.mode == "external":
            return True
        if identity.status == "disabled" or not any((identity.rgw_uid, identity.access_key, identity.secret_key, identity.provenance)):
            identity.status, identity.last_error = "disabled", None
            self.db.commit()
            return True
        identity.status = "revocation_pending"
        self.db.commit()  # Access is denied even if remote revocation subsequently fails.
        try:
            admin, permissions = self.admin_permissions(endpoint)
            payload = admin.get_user(identity.rgw_uid, allow_not_found=True)
            provenance = f"{self.installation_id()}:{endpoint.identity_namespace}"
            if payload is not None:
                if (
                    identity.provenance != provenance
                    or not self.validation.owns(identity, payload)
                ):
                    raise ValueError("Cannot revoke an RGW identity without ownership proof.")
                self.validation.validate_managed_keys(identity, payload)
                if not permissions.users_write:
                    raise ValueError("Revocation requires Admin Ops users=write.")
                admin.delete_user(identity.rgw_uid)  # Never purge buckets or objects.
                if admin.get_user(identity.rgw_uid, allow_not_found=True) is not None:
                    raise ValueError("RGW did not confirm service identity revocation.")
            identity.status = "disabled"
            identity.access_key = identity.secret_key = None
            from app.db import KeyRotationIntent
            key_type = f"endpoint_{kind}"
            self.db.execute(
                delete(KeyRotationIntent)
                .where(
                    KeyRotationIntent.endpoint_id == endpoint.id,
                    KeyRotationIntent.key_type == key_type,
                    KeyRotationIntent.target_id == identity.id,
                )
                .execution_options(synchronize_session=False)
            )
            identity.last_error = None
            identity.last_reconciled_at = utcnow()
            self.db.commit()
            self._audit(endpoint, identity, "revoked")
            return True
        except ManagedIdentityKeyDriftError as exc:
            self.db.rollback()
            self.record_key_drift(endpoint, identity, exc)
            return False
        except (ValueError, RGWAdminError):
            self.db.rollback()
            identity.status = "revocation_pending"
            identity.last_error = "Remote revocation is pending; check Admin Ops permissions and RGW connectivity."
            self.db.commit()
            return False

    def _record_admin_validation_failure(
        self,
        endpoint: StorageEndpoint,
        desired: list[ManagedServiceIdentityKind],
        exc: ValueError | RGWAdminError,
        *,
        provision_unprovisioned: bool,
    ) -> None:
        failure = (
            classify_rgw_credential_failure(exc)
            if isinstance(exc, RGWAdminError)
            else None
        )
        for kind in desired:
            identity = endpoint.service_identity(kind)
            if skip_unprovisioned_identity(
                identity,
                provision_unprovisioned=provision_unprovisioned,
            ):
                continue
            if identity is None or identity.status in ("ready", "revocation_pending", "disabled"):
                continue
            identity.status = "error"
            identity.last_error = (
                f"Unable to configure {kind}: {sanitized_error_log_detail(exc)}"
                if failure == "misconfigured"
                else "Admin Ops validation failed; check its required read permissions and RGW connectivity."
            )
        self.db.commit()

    def _record_identity_reconcile_failure(
        self,
        endpoint: StorageEndpoint,
        kind: ManagedServiceIdentityKind,
        exc: ValueError | RGWAdminError,
        *,
        default_mode: str,
    ) -> EndpointServiceIdentity:
        self.db.rollback()
        identity = endpoint.service_identity(kind)
        if identity is None:
            identity = EndpointServiceIdentity(
                kind=kind,
                mode=default_mode,
                status="error",
            )
            endpoint.service_identities.append(identity)
        failure = (
            classify_rgw_credential_failure(exc)
            if isinstance(exc, RGWAdminError)
            else None
        )
        unavailable = failure == "unavailable"
        if identity.status != "revocation_pending":
            if not (unavailable and identity.status == "ready"):
                identity.status = "error"
            identity.last_error = (
                f"Unable to configure {kind}: {sanitized_error_log_detail(exc)}"
                if failure == "misconfigured"
                else f"{kind} validation is temporarily unavailable; existing credentials remain configured."
                if unavailable and identity.status == "ready"
                else f"Unable to configure {kind}; check credentials, required caps, ownership and RGW connectivity."
            )
        self.db.commit()
        return identity

    def _reconcile_service_identity(
        self,
        endpoint: StorageEndpoint,
        kind: ManagedServiceIdentityKind,
        admin: RGWAdminClient,
        permissions: StorageEndpointAdminOpsPermissions,
        *,
        default_mode: str,
        provision_unprovisioned: bool,
    ) -> dict[str, str]:
        identity = endpoint.service_identity(kind)
        if skip_unprovisioned_identity(
            identity,
            provision_unprovisioned=provision_unprovisioned,
        ):
            return {"kind": kind, "status": identity.status}
        if identity is not None and identity.status == "revocation_pending":
            self.revoke(endpoint, kind)
            return {"kind": kind, "status": identity.status}
        mode = identity.mode if identity is not None else default_mode
        try:
            identity = self._ensure(
                endpoint,
                kind,
                admin,
                permissions,
                managed=mode == "managed",
            )
        except ManagedIdentityKeyDriftError as exc:
            self.db.rollback()
            identity = endpoint.service_identity(kind)
            self.record_key_drift(endpoint, identity, exc)
        except (ValueError, RGWAdminError) as exc:
            identity = self._record_identity_reconcile_failure(
                endpoint,
                kind,
                exc,
                default_mode=default_mode,
            )
        return {"kind": kind, "status": identity.status}

    def reconcile(
        self,
        endpoint: StorageEndpoint,
        *,
        locked: bool = False,
        provision_unprovisioned: bool = False,
    ) -> list[dict[str, str]]:
        if endpoint.provider != "ceph":
            return []
        lease, handle = (None, None) if locked else self.lease(endpoint)
        results = []
        try:
            results.append(self.validate_ceph_admin(endpoint))
            desired = desired_service_kinds(endpoint)
            if not desired or not endpoint.admin_access_key or not endpoint.admin_secret_key:
                return results
            try:
                admin, permissions = self.admin_permissions(endpoint)
            except (ValueError, RGWAdminError) as exc:
                self._record_admin_validation_failure(
                    endpoint,
                    desired,
                    exc,
                    provision_unprovisioned=provision_unprovisioned,
                )
                return [{"kind": "admin", "status": "error"}]
            runtime = endpoint.service_identity("runtime")
            default_mode = runtime.mode if runtime is not None else "managed"
            for kind in desired:
                results.append(
                    self._reconcile_service_identity(
                        endpoint,
                        kind,
                        admin,
                        permissions,
                        default_mode=default_mode,
                        provision_unprovisioned=provision_unprovisioned,
                    )
                )
            return results
        finally:
            if lease is not None:
                lease.release(handle)
