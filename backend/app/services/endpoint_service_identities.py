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
from app.services.rgw_admin_identity import extract_ceph_admin_flags
from app.services.rgw_endpoint_clients import get_endpoint_bootstrap_rgw_client
from app.services.storage_endpoint_admin_permissions import _parse_caps_payload, admin_ops_permissions_from_caps
from app.utils.storage_endpoint_features import dump_features_config, normalize_features_config
from app.utils.time import utcnow

SERVICE_CAPS = {
    "runtime": "accounts=read;user-info-without-keys=read;buckets=read",
    "supervision": "usage=read;buckets=read",
}
INSTALLATION_KEY = "endpoint-service-identity-installation"


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
        return bool(isinstance(payload, dict) and identity.access_key and any(
            key.get("access_key") == identity.access_key
            for key in payload.get("keys", []) if isinstance(key, dict)
        ))

    def _lease(self, endpoint):
        # The bound exceeds the configured RGW timeouts for this workflow.
        lease = OperationLeaseService(self.db)
        handle = lease.acquire(f"endpoint-identities:{endpoint.id}", ttl_seconds=1800)
        if handle is None:
            raise ValueError("Service identity configuration is already running for this endpoint.")
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
                raise ValueError("Managed Ceph Admin requires admin=true and system=false.")
            return
        expected = _parse_caps_payload(SERVICE_CAPS[kind])
        actual = _parse_caps_payload(payload.get("caps"))
        if is_admin or is_system or actual != expected:
            raise ValueError(f"{kind} identity must have only {SERVICE_CAPS[kind]} and no admin/system flag.")

    def _functional_check(self, endpoint, identity):
        from app.services.rgw_admin import get_rgw_admin_client
        from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint
        client = get_rgw_admin_client(access_key=identity.access_key, secret_key=identity.secret_key,
                                      endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region,
                                      verify_tls=endpoint.verify_tls)
        if identity.kind == "runtime":
            payload = client.get_user_by_access_key(identity.access_key, allow_not_found=True)
            if not isinstance(payload, dict) or not (payload.get("user_id") or payload.get("uid")) or payload.get("keys") or payload.get("swift_keys") or payload.get("temp_url_keys"):
                raise ValueError("Runtime user lookup must succeed without returning keys.")
            client.get_account("RGW00000000000000000", allow_not_found=True)
            client.get_all_buckets(uid=identity.rgw_uid, with_stats=True)
        elif identity.kind == "supervision":
            client.get_all_buckets(with_stats=True)
            client.get_usage(show_entries=False, show_summary=True)
        else:
            self.validate_payload("ceph_admin", client.get_user_by_access_key(identity.access_key, allow_not_found=True))

    def _ensure(self, endpoint, kind, admin, permissions, *, managed):
        identity = endpoint.service_identity(kind)
        if managed:
            if not permissions.users_write:
                raise ValueError("Managed service identities require Admin Ops users=write.")
            if identity is not None and identity.mode == "external":
                # Conversion detaches external credentials, never mutates the external principal.
                identity.access_key = identity.secret_key = identity.rgw_uid = None
                identity.status = "missing"
            if identity is None:
                identity = EndpointServiceIdentity(kind=kind, mode="managed", status="missing")
                endpoint.service_identities.append(identity)
            identity.mode = "managed"
            installation = self._installation_id()
            provenance = f"{installation}:{endpoint.identity_namespace}"
            if identity.provenance not in (None, provenance):
                raise ValueError("Service identity ownership does not match this installation.")
            identity.provenance = provenance
            identity.rgw_uid = f"bkr-{installation[:12]}-{endpoint.identity_namespace[:12]}-{kind.replace('_', '-')}"
            if not identity.access_key:
                identity.access_key = secrets.token_hex(10).upper()
                identity.secret_key = secrets.token_urlsafe(32)
            identity.status = "provisioning"
            self.db.commit()  # Persist key/provenance before creating anything remotely.
            payload = admin.get_user(identity.rgw_uid, allow_not_found=True)
            if payload is not None and not self._owns(identity, payload):
                raise ValueError("RGW service UID collision; the existing user will not be modified.")
            if payload is None:
                payload = admin.create_user(
                    identity.rgw_uid, display_name=f"BucketReef {kind} service",
                    generate_key=False, extra_params={"access-key": identity.access_key, "secret-key": identity.secret_key,
                                                      "max-buckets": 0},
                )
                if not self._owns(identity, payload):
                    raise ValueError("RGW did not confirm ownership of the new service identity.")
                self._audit(endpoint, identity, "created")
            if kind == "ceph_admin":
                admin.update_user(identity.rgw_uid, admin=True, system=False)
            else:
                admin.set_user_caps(identity.rgw_uid, SERVICE_CAPS[kind])
        else:
            if identity is None or not identity.access_key or not identity.secret_key:
                raise ValueError(f"Externally managed endpoints require complete {kind} credentials.")
            if identity.mode != "external":
                raise ValueError("Revoke the managed identity before supplying an external replacement.")
        payload = admin.get_user_by_access_key(identity.access_key, allow_not_found=True)
        self.validate_payload(kind, payload)
        identity.rgw_uid = str(payload.get("user_id") or payload.get("uid") or identity.rgw_uid or "")
        self._functional_check(endpoint, identity)
        identity.status, identity.last_error = "ready", None
        identity.last_reconciled_at = utcnow()
        self.db.commit()
        self._audit(endpoint, identity, "validated")
        return identity

    def revoke(self, endpoint, kind):
        identity = endpoint.service_identity(kind)
        if identity is None or identity.mode == "external":
            return True
        identity.status = "revocation_pending"
        self.db.commit()  # Access is denied even if remote revocation subsequently fails.
        try:
            admin, permissions = self.admin_permissions(endpoint)
            if not permissions.users_write:
                raise ValueError("Revocation requires Admin Ops users=write.")
            payload = admin.get_user(identity.rgw_uid, allow_not_found=True)
            provenance = f"{self._installation_id()}:{endpoint.identity_namespace}"
            if identity.provenance != provenance or (payload is not None and not self._owns(identity, payload)):
                raise ValueError("Cannot revoke an RGW identity without ownership proof.")
            if payload is not None:
                admin.delete_user(identity.rgw_uid)  # Never purge buckets or objects.
                if admin.get_user(identity.rgw_uid, allow_not_found=True) is not None:
                    raise ValueError("RGW did not confirm service identity revocation.")
            identity.status = "disabled"
            identity.access_key = identity.secret_key = identity.previous_access_key = None
            identity.last_error = None
            identity.last_reconciled_at = utcnow()
            self.db.commit()
            self._audit(endpoint, identity, "revoked")
            return True
        except (ValueError, RGWAdminError):
            self.db.rollback()
            identity.status = "revocation_pending"
            identity.last_error = "Remote revocation is pending; check Admin Ops permissions and RGW connectivity."
            self.db.commit()
            return False

    def rotate(self, endpoint, kind, *, deactivate_only=False):
        lease, handle = self._lease(endpoint)
        try:
            identity = endpoint.service_identity(kind)
            if identity is None or identity.mode != "managed" or identity.status != "ready":
                raise ValueError("Only ready managed service identities can be rotated.")
            admin, permissions = self.admin_permissions(endpoint)
            if not permissions.users_write:
                raise ValueError("Managed key rotation requires Admin Ops users=write.")
            payload = admin.get_user(identity.rgw_uid, allow_not_found=True)
            provenance = f"{self._installation_id()}:{endpoint.identity_namespace}"
            if identity.provenance != provenance or not self._owns(identity, payload):
                raise ValueError("Cannot rotate an identity without ownership proof.")
            old_access = identity.previous_access_key or identity.access_key
            if not identity.previous_access_key:
                from app.services.rgw_user_key_parser import RgwUserKeyParser
                response = admin.create_access_key(identity.rgw_uid)
                access, secret = RgwUserKeyParser.select_credentials(admin.extract_keys(response), exclude_access_key=old_access)
                if not access or not secret or access == old_access:
                    raise ValueError("RGW did not return a new service key.")
                identity.access_key, identity.secret_key = access, secret
                try:
                    self._functional_check(endpoint, identity)
                    identity.previous_access_key = old_access
                    self.db.commit()
                except Exception:
                    self.db.rollback()
                    admin.delete_access_key(identity.rgw_uid, access)
                    raise
            try:
                if deactivate_only:
                    admin.set_access_key_status(identity.rgw_uid, old_access, enabled=False)
                else:
                    admin.delete_access_key(identity.rgw_uid, old_access)
            except RGWAdminError as exc:
                identity.last_error = "New key is active; retirement of the previous key is pending. Retry rotation."
                self.db.commit()
                raise ValueError(identity.last_error) from exc
            identity.previous_access_key = identity.last_error = None
            identity.last_reconciled_at = utcnow()
            self.db.commit()
            self._audit(endpoint, identity, "rotated")
            return old_access, identity.access_key, "disabled" if deactivate_only else "deleted"
        finally:
            lease.release(handle)

    def reconcile(self, endpoint, *, ceph_admin_enabled=None, locked=False):
        if endpoint.provider != "ceph":
            return []
        lease, handle = (None, None) if locked else self._lease(endpoint)
        results = []
        try:
            if ceph_admin_enabled is None:
                from app.services.app_settings_service import load_app_settings_for_db_readonly
                ceph_admin_enabled = load_app_settings_for_db_readonly(self.db).general.ceph_admin_enabled
            desired_ceph = bool(ceph_admin_enabled and endpoint.ceph_admin_allowed)
            if not desired_ceph:
                self.revoke(endpoint, "ceph_admin")
            if not endpoint.admin_access_key or not endpoint.admin_secret_key:
                return results
            try:
                admin, permissions = self.admin_permissions(endpoint)
            except (ValueError, RGWAdminError):
                for kind in ("runtime", "supervision", "ceph_admin"):
                    identity = endpoint.service_identity(kind)
                    if identity is not None and identity.status != "revocation_pending":
                        identity.status = "error"
                        identity.last_error = "Admin Ops validation failed; check its required read permissions and RGW connectivity."
                self.db.commit()
                return [{"kind": "admin", "status": "error"}]
            if not permissions.users_write and endpoint.service_identity_mode == "managed":
                endpoint.service_identity_mode = "external"
                self.db.commit()
            features = normalize_features_config(endpoint.provider, endpoint.features_config, endpoint.region)
            if features["usage"]["enabled"] and not permissions.usage_read:
                features["usage"]["enabled"] = False
                endpoint.features_config = dump_features_config(features)
                self.db.commit()
            desired = ["runtime"]
            if features["usage"]["enabled"] or features["metrics"]["enabled"]:
                desired.append("supervision")
            else:
                self.revoke(endpoint, "supervision")
            if desired_ceph:
                desired.append("ceph_admin")
            for kind in desired:
                try:
                    identity = self._ensure(endpoint, kind, admin, permissions,
                                            managed=kind == "ceph_admin" or endpoint.service_identity_mode == "managed")
                    results.append({"kind": kind, "status": identity.status})
                except (ValueError, RGWAdminError):
                    self.db.rollback()
                    identity = endpoint.service_identity(kind)
                    if identity is None:
                        identity = EndpointServiceIdentity(kind=kind, mode="managed" if kind == "ceph_admin" else endpoint.service_identity_mode, status="error")
                        endpoint.service_identities.append(identity)
                    identity.status = "error"
                    identity.last_error = f"Unable to configure {kind}; check credentials, required caps and RGW connectivity."
                    self.db.commit()
                    results.append({"kind": kind, "status": "error"})
            return results
        finally:
            if lease is not None:
                lease.release(handle)
