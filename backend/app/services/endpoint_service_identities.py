# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Provision, validate and revoke endpoint identities with durable ownership proof."""
from __future__ import annotations

import json
import secrets
from uuid import uuid4

from sqlalchemy.exc import IntegrityError

from app.db import AppSetting, EndpointServiceIdentity, StorageEndpoint
from app.services.audit_service import AuditService
from app.services.operation_lease_service import OperationLeaseService
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_admin_identity import extract_ceph_admin_flags, classify_rgw_credential_failure
from app.services.rgw_endpoint_clients import get_endpoint_bootstrap_rgw_client
from app.services.storage_endpoint_admin_permissions import _parse_caps_payload, admin_ops_permissions_from_caps
from app.utils.time import utcnow

SERVICE_CAPS = {
    "runtime": "accounts=read;user-info-without-keys=read;buckets=read",
    "supervision": "usage=read;buckets=read",
}
INSTALLATION_KEY = "endpoint-service-identity-installation"
STARTUP_RECOVERY_KEY_TYPES = frozenset({"endpoint_runtime", "endpoint_supervision"})


class ManagedIdentityKeyDriftError(ValueError):
    """Remote keys differ from the keys tracked by BucketReef."""

    def __init__(self):
        super().__init__(
            "Managed service identity key drift detected. Remove unexpected RGW keys "
            "externally, then retry service identity configuration."
        )


class EndpointServiceIdentityService:
    def __init__(self, db, *, actor=None, client_factory=None):
        self.db = db
        self.actor = actor
        self.client_factory = client_factory or get_endpoint_bootstrap_rgw_client

    def _installation_id(self):
        row = self.db.get(AppSetting, INSTALLATION_KEY)
        if row is None:
            row = AppSetting(key=INSTALLATION_KEY, payload_json=json.dumps(uuid4().hex))
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                row = self.db.get(AppSetting, INSTALLATION_KEY)
        return json.loads(row.payload_json)

    def _audit(self, endpoint, identity, action):
        AuditService(self.db).record_action(
            user=self.actor, user_email="system" if self.actor is None else None,
            scope="admin", action=f"endpoint_service_identity.{action}",
            entity_type="storage_endpoint", entity_id=str(endpoint.id),
            metadata={"endpoint_id": endpoint.id, "kind": identity.kind, "uid": identity.rgw_uid,
                      "mode": identity.mode, "executor": identity.kind if action == "validated" else "admin_ops", "workflow": "endpoint-service-identities"},
        )

    @staticmethod
    def _owns(identity, payload):
        return bool(isinstance(payload, dict) and isinstance(payload.get("keys"), list) and identity.access_key and any(
            key.get("access_key") == identity.access_key
            for key in payload.get("keys", []) if isinstance(key, dict)
        ))

    def _validate_managed_keys(self, identity, payload):
        if not isinstance(payload, dict):
            raise ManagedIdentityKeyDriftError()
        from app.services.durable_key_rotation_service import pending_rotation
        key_type = f"endpoint_{identity.kind}"
        intent = pending_rotation(self.db, identity.endpoint_id, key_type, identity.id)
        allowed = {identity.access_key}
        if intent is not None:
            allowed.update((intent.old_access_key, intent.new_access_key))
        keys = payload.get("keys")
        if (
            not isinstance(keys, list)
            or any(
                not isinstance(key, dict)
                or not isinstance(key.get("access_key"), str)
                or key["access_key"] not in allowed
                for key in keys
            )
            or not any(key["access_key"] == identity.access_key for key in keys)
            or payload.get("swift_keys")
            or payload.get("temp_url_keys")
        ):
            raise ManagedIdentityKeyDriftError()

    def _record_key_drift(self, endpoint, identity, error):
        changed = identity.last_error != str(error)
        if identity.status != "revocation_pending":
            identity.status = "error"
        identity.last_error = str(error)
        identity.last_reconciled_at = utcnow()
        self.db.commit()
        if changed:
            self._audit(endpoint, identity, "key_drift_detected")

    def _lease(self, endpoint):
        # The bound exceeds the configured RGW timeouts for this workflow.
        endpoint_id = endpoint.id
        lease = OperationLeaseService(self.db)
        handle = lease.acquire(f"endpoint-identities:{endpoint_id}", ttl_seconds=1800)
        if handle is None:
            raise ValueError("Service identity configuration is already running for this endpoint.")
        current = self.db.query(StorageEndpoint).populate_existing().filter_by(id=endpoint_id).first()
        if current is None:
            lease.release(handle)
            raise ValueError("Endpoint no longer exists.")
        return lease, handle

    def admin_permissions(self, endpoint):
        admin = self.client_factory(endpoint)
        payload = admin.get_user_by_access_key(endpoint.admin_access_key, allow_not_found=True)
        if not isinstance(payload, dict):
            raise ValueError("Admin Ops access key is not recognized by RGW.")
        permissions = admin_ops_permissions_from_caps(payload.get("caps"))
        if not permissions.users_read or not permissions.accounts_read:
            raise ValueError("Admin Ops requires users=read and accounts=read.")
        return admin, permissions

    @staticmethod
    def validate_payload(kind, payload):
        if not isinstance(payload, dict) or not payload:
            raise ValueError(f"{kind} access key is not recognized by RGW.")
        is_admin, is_system = extract_ceph_admin_flags(payload)
        if kind == "ceph_admin":
            if not is_admin or is_system:
                raise ValueError("Ceph Admin requires admin=true and system=false.")
            return
        expected = _parse_caps_payload(SERVICE_CAPS[kind])
        actual = _parse_caps_payload(payload.get("caps"))
        if is_admin or is_system or actual != expected:
            raise ValueError(f"{kind} identity must have only {SERVICE_CAPS[kind]} and no admin/system flag.")

    @classmethod
    def validate_functional_access(
        cls,
        kind,
        client,
        *,
        access_key=None,
        bucket_uid=None,
        check_buckets=True,
        check_usage=True,
    ):
        if kind == "runtime":
            if not access_key:
                raise ValueError("Runtime access key is required for validation.")
            payload = client.get_user_by_access_key(access_key, allow_not_found=True)
            cls.validate_payload("runtime", payload)
            uid = payload.get("user_id") or payload.get("uid")
            if (
                not uid
                or payload.get("keys")
                or payload.get("swift_keys")
                or payload.get("temp_url_keys")
            ):
                raise ValueError("Runtime user lookup must succeed without returning keys.")
            client.get_account("RGW00000000000000000", allow_not_found=True)
            if check_buckets:
                client.get_all_buckets(uid=bucket_uid or str(uid), with_stats=True)
            return None

        if kind == "supervision":
            if check_buckets:
                client.get_all_buckets(with_stats=True)
            if check_usage:
                return client.get_usage(show_entries=False, show_summary=True)
            return None

        if kind == "ceph_admin":
            if not access_key:
                raise ValueError("Ceph Admin access key is required for validation.")
            cls.validate_payload(
                "ceph_admin",
                client.get_user_by_access_key(access_key, allow_not_found=True),
            )
            return None

        raise ValueError(f"Unsupported service identity kind: {kind}.")

    def _functional_check(self, endpoint, identity):
        from app.services.rgw_admin import get_rgw_admin_client
        from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
        client = get_rgw_admin_client(access_key=identity.access_key, secret_key=identity.secret_key,
                                      endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region,
                                      verify_tls=endpoint.verify_tls)
        self.validate_functional_access(
            identity.kind,
            client,
            access_key=identity.access_key,
            bucket_uid=identity.rgw_uid,
        )

    def _ensure(self, endpoint, kind, admin, permissions, *, managed):
        if kind == "ceph_admin":
            raise ValueError("Ceph Admin credentials must be supplied manually.")
        identity = endpoint.service_identity(kind)
        if managed:
            if identity is None:
                identity = EndpointServiceIdentity(kind=kind, mode="managed", status="missing")
                endpoint.service_identities.append(identity)
            if identity.mode != "managed":
                raise ValueError("Explicit conversion is required before provisioning a managed identity.")
            if not identity.rgw_uid or not identity.access_key:
                if not permissions.users_write:
                    raise ValueError("Managed service identities require Admin Ops users=write.")
                installation = self._installation_id()
                provenance = f"{installation}:{endpoint.identity_namespace}"
                if identity.provenance not in (None, provenance):
                    raise ValueError("Service identity ownership does not match this installation.")
                identity.provenance = provenance
                identity.rgw_uid = f"bkr-{installation[:12]}-{endpoint.identity_namespace[:12]}-{kind.replace('_', '-')}"
                identity.access_key = identity.access_key or secrets.token_hex(10).upper()
                identity.secret_key = identity.secret_key or secrets.token_urlsafe(32)
                identity.status = "provisioning"
                self.db.commit()
            provenance = f"{self._installation_id()}:{endpoint.identity_namespace}"
            if identity.provenance != provenance:
                raise ValueError("Cannot validate a managed identity without ownership proof.")
            payload = admin.get_user(identity.rgw_uid, allow_not_found=True)
            if payload is not None and not self._owns(identity, payload):
                raise ValueError("RGW service UID collision; the existing user will not be modified.")
            if payload is not None:
                self._validate_managed_keys(identity, payload)
            created = payload is None
            if payload is None:
                if not permissions.users_write:
                    raise ValueError("Managed service identity is absent; recreation requires users=write.")
                identity.status = "provisioning"
                self.db.commit()
                payload = admin.create_user(identity.rgw_uid, display_name=f"BucketReef {kind} service",
                    generate_key=False, extra_params={"access-key": identity.access_key, "secret-key": identity.secret_key, "max-buckets": 0})
                if not self._owns(identity, payload):
                    raise ValueError("RGW did not confirm ownership of the new service identity.")
                self._validate_managed_keys(identity, payload)
                self._audit(endpoint, identity, "created")
            # Only bootstrap an identity that has never passed validation. Do not
            # rewrite permissions or interrupt a previously operational identity.
            if (created or identity.last_reconciled_at is None) and permissions.users_write:
                admin.set_user_caps(identity.rgw_uid, SERVICE_CAPS[kind])
        else:
            if identity is None or not identity.access_key or not identity.secret_key:
                raise ValueError(f"Externally managed endpoints require complete {kind} credentials.")
            if identity.mode != "external":
                raise ValueError("Revoke the managed identity before supplying an external replacement.")
        payload = admin.get_user_by_access_key(identity.access_key, allow_not_found=True)
        self.validate_payload(kind, payload)
        if managed:
            self._validate_managed_keys(identity, payload)
        identity.rgw_uid = str(payload.get("user_id") or payload.get("uid") or identity.rgw_uid or "")
        self._functional_check(endpoint, identity)
        identity.status, identity.last_error = "ready", None
        identity.last_reconciled_at = utcnow()
        self.db.commit()
        self._audit(endpoint, identity, "validated")
        return identity

    def validate_ceph_admin(self, endpoint):
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
                self.validate_payload("ceph_admin", payload)
                uid = payload.get("user_id") or payload.get("uid")
                if not uid:
                    raise ValueError("Ceph Admin user could not be identified by RGW.")
                identity.rgw_uid = str(uid)
                identity.status, identity.last_error = "ready", None
                self._audit(endpoint, identity, "validated")
            except ValueError as exc:
                identity.status, identity.last_error = "error", str(exc)
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

    def revoke(self, endpoint, kind):
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
            provenance = f"{self._installation_id()}:{endpoint.identity_namespace}"
            if payload is not None:
                if identity.provenance != provenance or not self._owns(identity, payload):
                    raise ValueError("Cannot revoke an RGW identity without ownership proof.")
                self._validate_managed_keys(identity, payload)
                if not permissions.users_write:
                    raise ValueError("Revocation requires Admin Ops users=write.")
                admin.delete_user(identity.rgw_uid)  # Never purge buckets or objects.
                if admin.get_user(identity.rgw_uid, allow_not_found=True) is not None:
                    raise ValueError("RGW did not confirm service identity revocation.")
            identity.status = "disabled"
            identity.access_key = identity.secret_key = None
            from app.db import KeyRotationIntent
            key_type = f"endpoint_{kind}"
            self.db.query(KeyRotationIntent).filter_by(endpoint_id=endpoint.id, key_type=key_type, target_id=identity.id).delete(synchronize_session=False)
            identity.last_error = None
            identity.last_reconciled_at = utcnow()
            self.db.commit()
            self._audit(endpoint, identity, "revoked")
            return True
        except ManagedIdentityKeyDriftError as exc:
            self.db.rollback()
            self._record_key_drift(endpoint, identity, exc)
            return False
        except (ValueError, RGWAdminError):
            self.db.rollback()
            identity.status = "revocation_pending"
            identity.last_error = "Remote revocation is pending; check Admin Ops permissions and RGW connectivity."
            self.db.commit()
            return False

    def rotate(self, endpoint, kind, *, deactivate_only=False):
        from app.services.durable_key_rotation_service import DurableKeyRotationService
        identity = endpoint.service_identity(kind)
        if identity is None or identity.mode != "managed":
            raise ValueError("Only ready managed service identities can be rotated.")
        key_type = f"endpoint_{kind}"
        return DurableKeyRotationService(self.db, actor=self.actor, identity_service=self).rotate(
            endpoint, key_type, identity.id, deactivate_only=deactivate_only)

    @staticmethod
    def _identity_is_locally_ready(identity) -> bool:
        if (
            identity is None
            or identity.status != "ready"
            or not identity.rgw_uid
            or not identity.access_key
            or not identity.secret_key
        ):
            return False
        return identity.mode != "managed" or bool(identity.provenance)

    def needs_startup_reconciliation(self, endpoint, *, ceph_admin_enabled: bool) -> bool:
        """Return whether persisted local state requires an RGW recovery pass."""
        if endpoint.provider != "ceph":
            return False

        for kind in ("runtime", "supervision"):
            identity = endpoint.service_identity(kind)
            if (
                identity is not None
                and identity.mode == "managed"
                and identity.status == "not_provisioned"
            ):
                continue
            if not self._identity_is_locally_ready(identity):
                return True

        ceph_admin = endpoint.service_identity("ceph_admin")
        if ceph_admin is not None and ceph_admin.access_key and ceph_admin.secret_key:
            if not self._identity_is_locally_ready(ceph_admin):
                return True

        return any(
            intent.key_type in STARTUP_RECOVERY_KEY_TYPES
            for intent in endpoint.key_rotation_intents
        )

    def reconcile(
        self,
        endpoint,
        *,
        ceph_admin_enabled=None,
        locked=False,
        provision_unprovisioned=False,
    ):
        if endpoint.provider != "ceph":
            return []
        lease, handle = (None, None) if locked else self._lease(endpoint)
        results = []
        try:
            results.append(self.validate_ceph_admin(endpoint))
            if not endpoint.admin_access_key or not endpoint.admin_secret_key:
                return results
            try:
                admin, permissions = self.admin_permissions(endpoint)
            except (ValueError, RGWAdminError) as exc:
                failure = (
                    classify_rgw_credential_failure(exc)
                    if isinstance(exc, RGWAdminError)
                    else None
                )
                for kind in ("runtime", "supervision"):
                    identity = endpoint.service_identity(kind)
                    if (
                        not provision_unprovisioned
                        and identity is not None
                        and identity.mode == "managed"
                        and identity.status == "not_provisioned"
                    ):
                        continue
                    if identity is not None and identity.status not in ("ready", "revocation_pending", "disabled"):
                        identity.status = "error"
                        identity.last_error = (
                            f"Unable to configure {kind}: {exc}"
                            if failure == "misconfigured"
                            else "Admin Ops validation failed; check its required read permissions and RGW connectivity."
                        )
                self.db.commit()
                return [{"kind": "admin", "status": "error"}]
            # Baseline endpoint identities persist independently of feature activation.
            desired = ["runtime", "supervision"]
            runtime = endpoint.service_identity("runtime")
            if runtime is None:
                runtime = EndpointServiceIdentity(
                    kind="runtime",
                    mode="managed",
                    status="missing",
                )
                endpoint.service_identities.append(runtime)
                self.db.commit()
            for kind in desired:
                try:
                    identity = endpoint.service_identity(kind)
                    if (
                        not provision_unprovisioned
                        and identity is not None
                        and identity.mode == "managed"
                        and identity.status == "not_provisioned"
                    ):
                        results.append({"kind": kind, "status": identity.status})
                        continue
                    if identity is not None and identity.status == "revocation_pending":
                        self.revoke(endpoint, kind)
                        results.append({"kind": kind, "status": identity.status})
                        continue
                    mode = identity.mode if identity is not None else runtime.mode
                    identity = self._ensure(endpoint, kind, admin, permissions,
                                            managed=mode == "managed")
                    results.append({"kind": kind, "status": identity.status})
                except ManagedIdentityKeyDriftError as exc:
                    self.db.rollback()
                    identity = endpoint.service_identity(kind)
                    self._record_key_drift(endpoint, identity, exc)
                    results.append({"kind": kind, "status": identity.status})
                except (ValueError, RGWAdminError) as exc:
                    self.db.rollback()
                    identity = endpoint.service_identity(kind)
                    if identity is None:
                        identity = EndpointServiceIdentity(
                            kind=kind,
                            mode=runtime.mode,
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
                            f"Unable to configure {kind}: {exc}"
                            if failure == "misconfigured"
                            else f"{kind} validation is temporarily unavailable; existing credentials remain configured."
                            if unavailable and identity.status == "ready"
                            else f"Unable to configure {kind}; check credentials, required caps, ownership and RGW connectivity."
                        )
                    self.db.commit()
                    results.append({"kind": kind, "status": identity.status})
            return results
        finally:
            if lease is not None:
                lease.release(handle)
