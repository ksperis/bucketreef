# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Persist rotation intent before RGW writes and retire only validated keys."""
from __future__ import annotations

import secrets
from typing import TYPE_CHECKING

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import (
    EndpointServiceIdentity,
    KeyRotationIntent,
    S3Account,
    S3User,
    StorageEndpoint,
    User,
)
from app.services.audit_service import AuditService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError, get_rgw_admin_client
from app.utils.rgw_payloads import require_rgw_user_identity
from app.services.rgw_admin_identity import classify_rgw_credential_failure
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.storage_endpoint_features import resolve_rgw_admin_api_endpoint, resolve_feature_flags
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.services.endpoint_service_identities import EndpointServiceIdentityService

SERVICE_TYPES = {"endpoint_runtime": "runtime", "endpoint_supervision": "supervision"}
IDENTITY_TYPES = {**SERVICE_TYPES, "ceph_admin": "ceph_admin"}
RotationTarget = EndpointServiceIdentity | S3Account | S3User | StorageEndpoint


def pending_rotation(
    db: Session,
    endpoint_id: int,
    key_type: str,
    target_id: int,
) -> KeyRotationIntent | None:
    return (
        db.query(KeyRotationIntent)
        .filter_by(
            endpoint_id=endpoint_id,
            key_type=key_type,
            target_id=target_id,
        )
        .first()
    )


class ReplacementValidationError(ValueError):
    pass


class DurableKeyRotationService:
    def __init__(
        self,
        db: Session,
        *,
        actor: User | None = None,
        identity_service: EndpointServiceIdentityService | None = None,
    ) -> None:
        from app.services.endpoint_service_identities import EndpointServiceIdentityService

        self.db, self.actor = db, actor
        self.identities = identity_service or EndpointServiceIdentityService(db, actor=actor)

    def _audit(
        self,
        endpoint: StorageEndpoint,
        intent: KeyRotationIntent,
        action: str,
    ) -> None:
        AuditService(self.db).record_action(
            user=self.actor, user_email=intent.actor_email if self.actor is None else None,
            scope="admin", action=f"key_rotation.{action}", entity_type="storage_endpoint", entity_id=str(endpoint.id),
            metadata={"endpoint_id": endpoint.id, "key_type": intent.key_type, "target_id": intent.target_id,
                      "account_id": intent.target_id if intent.key_type == "account" else None,
                      "executor": "admin_ops", "workflow": "key-rotation", "phase": intent.phase},
        )

    def _target(
        self,
        endpoint: StorageEndpoint,
        key_type: str,
        target_id: int,
    ) -> RotationTarget:
        model = EndpointServiceIdentity if key_type in IDENTITY_TYPES else S3Account if key_type == "account" else S3User if key_type == "s3_user" else StorageEndpoint
        target = self.db.query(model).populate_existing().filter(model.id == target_id).first()
        if target is None or ((target.id if model == StorageEndpoint else target.endpoint_id if model == EndpointServiceIdentity else target.storage_endpoint_id) != endpoint.id):
            raise ValueError("Rotation target no longer belongs to this endpoint.")
        if key_type in SERVICE_TYPES and (target.kind != SERVICE_TYPES[key_type] or target.mode != "managed"):
            raise ValueError("Only managed service identities can be rotated.")
        if key_type == "ceph_admin" and (target.kind != "ceph_admin" or target.mode != "external"):
            raise ValueError("Ceph Admin rotation requires the configured external identity.")
        return target

    @staticmethod
    def _credentials(target: RotationTarget) -> tuple[str | None, str | None]:
        if isinstance(target, EndpointServiceIdentity):
            return target.access_key, target.secret_key
        if isinstance(target, StorageEndpoint):
            return target.admin_access_key, target.admin_secret_key
        return target.rgw_access_key, target.rgw_secret_key

    @staticmethod
    def _replace_credentials(target: RotationTarget, access_key: str, secret_key: str) -> None:
        if isinstance(target, EndpointServiceIdentity):
            target.access_key = access_key
            target.secret_key = secret_key
        elif isinstance(target, StorageEndpoint):
            target.admin_access_key = access_key
            target.admin_secret_key = secret_key
        else:
            target.rgw_access_key = access_key
            target.rgw_secret_key = secret_key

    @staticmethod
    def _principal_hint(target: RotationTarget) -> tuple[str | None, str | None]:
        if isinstance(target, EndpointServiceIdentity):
            return target.rgw_uid, None
        if isinstance(target, S3Account):
            return target.rgw_user_uid, target.rgw_tenant
        if isinstance(target, S3User):
            return target.rgw_user_uid, target.rgw_tenant
        return None, None

    def _validate(
        self,
        endpoint: StorageEndpoint,
        key_type: str,
        target: RotationTarget,
        admin: RGWAdminClient,
        payload: object,
        access: str,
        secret: str,
    ) -> None:
        if isinstance(target, (S3Account, S3User)):
            require_rgw_user_identity(payload, target.rgw_user_uid, target.rgw_tenant)
        entries = RgwUserKeyParser.to_access_keys(admin.extract_keys(payload), ui_managed_access_key=None)
        key = next((key for key in entries if key.access_key_id == access), None)
        pair = next((item for item in admin.extract_keys(payload) if item.get("access_key") == access), None)
        if key is None or not key.is_active or pair is None or pair.get("secret_key") != secret:
            raise ReplacementValidationError("RGW did not confirm an active replacement key for the expected principal.")
        if key_type in SERVICE_TYPES:
            try:
                self.identities.validate_payload(target.kind, payload)
            except ValueError as exc:
                raise ReplacementValidationError(str(exc)) from exc
            self.identities._validate_managed_keys(target, payload)
            try:
                self.identities._functional_check(
                    endpoint,
                    kind=target.kind,
                    rgw_uid=target.rgw_uid,
                    access_key=access,
                    secret_key=secret,
                )
            except ValueError as exc:
                raise ReplacementValidationError(str(exc)) from exc
            except RGWAdminError as exc:
                if classify_rgw_credential_failure(exc) == "denied":
                    raise ReplacementValidationError("Replacement service key was rejected by RGW.") from exc
                raise
        elif key_type == "ceph_admin":
            try:
                self.identities.validate_payload(
                    "ceph_admin",
                    payload,
                )
                self.identities._functional_check(
                    endpoint,
                    kind="ceph_admin",
                    rgw_uid=target.rgw_uid,
                    access_key=access,
                    secret_key=secret,
                )
            except ValueError as exc:
                raise ReplacementValidationError(str(exc)) from exc
            except RGWAdminError as exc:
                if classify_rgw_credential_failure(exc) == "denied":
                    raise ReplacementValidationError("Replacement Ceph Admin key was rejected by RGW.") from exc
                raise
        elif key_type == "endpoint_admin":
            from app.services.storage_endpoint_admin_permissions import admin_ops_permissions_from_caps
            client = get_rgw_admin_client(access_key=access, secret_key=secret, endpoint=resolve_rgw_admin_api_endpoint(endpoint), region=endpoint.region, verify_tls=endpoint.verify_tls)
            checked = client.get_user_by_access_key(access, allow_not_found=True)
            permissions = admin_ops_permissions_from_caps(checked.get("caps") if isinstance(checked, dict) else None)
            if not permissions.users_read or not permissions.accounts_read or not permissions.users_write:
                raise ValueError("Replacement Admin Ops key lacks required rotation permissions.")

    def rotate(
        self,
        endpoint: StorageEndpoint,
        key_type: str,
        target_id: int,
        *,
        deactivate_only: bool = False,
    ) -> tuple[str, str, str]:
        if deactivate_only and key_type in SERVICE_TYPES:
            raise ValueError("Managed service identities require deleting previous keys; select delete mode.")
        if key_type not in (*SERVICE_TYPES, "ceph_admin", "endpoint_admin", "account", "s3_user"):
            raise ValueError("Unsupported rotation category.")
        lease, handle = self.identities._lease(endpoint)
        intent = None
        try:
            endpoint_id = endpoint.id
            endpoint = self.db.query(StorageEndpoint).populate_existing().filter_by(id=endpoint_id).first()
            if endpoint is None or endpoint.provider != "ceph":
                raise ValueError("Key rotation is only supported for an available Ceph endpoint.")
            target = self._target(endpoint, key_type, target_id)
            intent = pending_rotation(self.db, endpoint.id, key_type, target.id)
            if key_type not in IDENTITY_TYPES and intent is None and not resolve_feature_flags(endpoint).admin_enabled:
                raise ValueError("Admin feature is disabled for this category.")
            if key_type in IDENTITY_TYPES and target.status != "ready" and intent is None:
                raise ValueError("Only ready service identities can be rotated.")
            admin, permissions = self.identities.admin_permissions(endpoint)
            if not permissions.users_write:
                raise ValueError("Key rotation requires Admin Ops users=write.")
            if intent is None:
                old_access, old_secret = self._credentials(target)
                if not old_access or not old_secret:
                    raise ValueError("Rotation credentials are not configured.")
                uid, preferred_tenant = self._principal_hint(target)
                tenant = None
                if uid is None:
                    from app.services.key_rotation_rgw import RgwAccessKeyRotator
                    uid, tenant = RgwAccessKeyRotator().resolve_identity_from_access_key(admin, old_access)
                elif isinstance(target, (S3Account, S3User)):
                    if preferred_tenant is None:
                        from app.services.key_rotation_rgw import RgwAccessKeyRotator
                        resolved_uid, tenant = RgwAccessKeyRotator().resolve_identity_from_access_key(admin, old_access)
                        if resolved_uid != uid:
                            raise ValueError("Stored RGW principal does not own the access key")
                        target.rgw_tenant = tenant or ""
                    else:
                        tenant = preferred_tenant or None
                elif key_type not in SERVICE_TYPES:
                    from app.services.key_rotation_rgw import RgwAccessKeyRotator
                    tenant = RgwAccessKeyRotator().detect_user_tenant(admin, uid=uid, preferred_tenant=preferred_tenant)
                payload = admin.get_user(uid, tenant=tenant, allow_not_found=True) if tenant else admin.get_user(uid, allow_not_found=True)
                if isinstance(target, (S3Account, S3User)):
                    require_rgw_user_identity(payload, uid, tenant or "")
                if key_type in SERVICE_TYPES:
                    provenance = f"{self.identities._installation_id()}:{endpoint.identity_namespace}"
                    if target.provenance != provenance or not self.identities._owns(target, payload):
                        raise ReplacementValidationError("Cannot rotate an identity without ownership proof.")
                    self.identities._validate_managed_keys(target, payload)
                if not any(item.get("access_key") == old_access for item in admin.extract_keys(payload)):
                    raise ValueError("Current key does not belong to the expected principal.")
                intent = KeyRotationIntent(endpoint_id=endpoint.id, key_type=key_type, target_id=target.id,
                    rgw_uid=uid, tenant=tenant, rgw_endpoint=resolve_rgw_admin_api_endpoint(endpoint), old_access_key=old_access,
                    new_access_key=secrets.token_hex(10).upper(), new_secret_key=secrets.token_urlsafe(32),
                    deactivate_only=deactivate_only, phase="prepared", actor_email=self.actor.email if self.actor else "system")
                self.db.add(intent)
                self.db.commit()
                self._audit(endpoint, intent, "prepared")
            if intent.rgw_endpoint != resolve_rgw_admin_api_endpoint(endpoint) or intent.deactivate_only != deactivate_only:
                raise ValueError("Resume rotation using its original RGW target and retirement mode.")
            expected = intent.new_access_key if intent.phase == "activated" else intent.old_access_key
            if isinstance(target, (S3Account, S3User)) and target.rgw_user_uid != intent.rgw_uid:
                raise ValueError("Rotation principal changed; restore the original target before retrying.")
            if isinstance(target, (S3Account, S3User)) and target.rgw_tenant != (intent.tenant or ""):
                raise ValueError("Rotation tenant changed; restore the original target before retrying.")
            current_access, _ = self._credentials(target)
            if current_access != expected:
                raise ValueError("Rotation target credentials changed; resolve the pending rotation before retrying.")
            if key_type in SERVICE_TYPES:
                provenance = f"{self.identities._installation_id()}:{endpoint.identity_namespace}"
                if target.provenance != provenance or target.rgw_uid != intent.rgw_uid:
                    raise ReplacementValidationError("Cannot rotate an identity without ownership proof.")
            kwargs = {"tenant": intent.tenant} if intent.tenant else {}
            payload = admin.get_user(intent.rgw_uid, **kwargs)
            if isinstance(target, (S3Account, S3User)):
                require_rgw_user_identity(payload, intent.rgw_uid, intent.tenant or "")
            if key_type in SERVICE_TYPES:
                if not self.identities._owns(target, payload):
                    raise ReplacementValidationError("Cannot rotate an identity without ownership proof.")
                self.identities._validate_managed_keys(target, payload)
            if intent.phase == "prepared":
                if not any(item.get("access_key") == intent.new_access_key for item in admin.extract_keys(payload)):
                    admin.create_access_key(intent.rgw_uid, **kwargs, access_key=intent.new_access_key, secret_key=intent.new_secret_key)
                    payload = admin.get_user(intent.rgw_uid, **kwargs)
                self._validate(endpoint, key_type, target, admin, payload, intent.new_access_key, intent.new_secret_key)
                self._replace_credentials(target, intent.new_access_key, intent.new_secret_key)
                intent.phase, intent.last_error = "activated", None
                self.db.commit()
                self._audit(endpoint, intent, "activated")
                if key_type == "endpoint_admin":
                    admin = self.identities.client_factory(endpoint)
            # Every retry must prove the replacement still works before retirement.
            payload = admin.get_user(intent.rgw_uid, **kwargs)
            self._validate(endpoint, key_type, target, admin, payload, intent.new_access_key, intent.new_secret_key)
            if any(item.get("access_key") == intent.old_access_key for item in admin.extract_keys(payload)):
                if intent.deactivate_only:
                    admin.set_access_key_status(intent.rgw_uid, intent.old_access_key, enabled=False, **kwargs)
                else:
                    admin.delete_access_key(intent.rgw_uid, intent.old_access_key, **kwargs)
            payload = admin.get_user(intent.rgw_uid, **kwargs)
            self._validate(endpoint, key_type, target, admin, payload, intent.new_access_key, intent.new_secret_key)
            old = next((key for key in RgwUserKeyParser.to_access_keys(admin.extract_keys(payload), ui_managed_access_key=None) if key.access_key_id == intent.old_access_key), None)
            if old is not None and (not intent.deactivate_only or old.is_active):
                raise ValueError("RGW did not confirm retirement of the previous key.")
            result = intent.old_access_key, intent.new_access_key, "disabled" if intent.deactivate_only else "deleted"
            self._audit(endpoint, intent, "completed")
            self.db.delete(intent)
            if key_type in IDENTITY_TYPES:
                target.last_error = None
                target.status = "ready"
                target.last_reconciled_at = utcnow()
            self.db.commit()
            return result
        except (ValueError, RGWAdminError, SQLAlchemyError) as exc:
            self.db.rollback()
            persisted = pending_rotation(self.db, endpoint.id, key_type, target_id)
            if persisted is not None:
                persisted.last_error = "Rotation pending; check credentials, permissions and RGW connectivity, then retry rotation."
                self.db.commit()
            from app.services.endpoint_service_identities import ManagedIdentityKeyDriftError
            if key_type in SERVICE_TYPES:
                target = self.db.get(EndpointServiceIdentity, target_id)
                if target is not None:
                    if isinstance(exc, ManagedIdentityKeyDriftError):
                        self.identities._record_key_drift(endpoint, target, exc)
                    elif isinstance(exc, ReplacementValidationError):
                        target.last_error = "Service rotation validation failed; check credentials and permissions, then retry."
                        target.status = "error"
                        self.db.commit()
            if isinstance(exc, SQLAlchemyError):
                raise ValueError("Rotation persistence failed; retry the pending rotation.") from None
            raise
        except BaseException:
            self.db.rollback()
            raise
        finally:
            lease.release(handle)
