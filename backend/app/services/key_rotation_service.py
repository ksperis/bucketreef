# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional, TypeVar

from sqlalchemy.orm import Session

from app.db import S3Account, S3User, StorageEndpoint
from app.models.key_rotation import (
    KeyRotationRequest,
    KeyRotationResponse,
    KeyRotationResultItem,
    KeyRotationSummary,
    KeyRotationType,
)
from app.services.key_rotation_rgw import RgwAccessKeyRotator
from app.core.sensitive_data import sanitized_error_log_detail


EndpointResource = TypeVar("EndpointResource", S3Account, S3User)


class KeyRotationService:
    _KEY_TYPE_ORDER: tuple[KeyRotationType, ...] = (
        KeyRotationType.ACCOUNT,
        KeyRotationType.S3_USER,
        KeyRotationType.ENDPOINT_RUNTIME,
        KeyRotationType.ENDPOINT_SUPERVISION,
        KeyRotationType.CEPH_ADMIN,
        KeyRotationType.ENDPOINT_ADMIN,
    )
    _ENV_MANAGED_ENDPOINT_KEY_TYPES: frozenset[KeyRotationType] = frozenset(
        {
            KeyRotationType.ENDPOINT_ADMIN,
            KeyRotationType.CEPH_ADMIN,
        }
    )

    def __init__(self, db: Session, *, actor=None) -> None:
        self.db = db
        self.actor = actor
        self._rgw = RgwAccessKeyRotator()

    def rotate_keys(self, payload: KeyRotationRequest) -> KeyRotationResponse:
        payload.validate_retirement_mode()
        endpoints = (
            self.db.query(StorageEndpoint)
            .filter(StorageEndpoint.id.in_(payload.endpoint_ids))
            .order_by(StorageEndpoint.id.asc())
            .all()
        )
        by_id = {endpoint.id: endpoint for endpoint in endpoints}
        missing_ids = [endpoint_id for endpoint_id in payload.endpoint_ids if endpoint_id not in by_id]
        if missing_ids:
            missing = ", ".join(str(entry) for entry in missing_ids)
            raise ValueError(f"Storage endpoint(s) not found: {missing}")

        selected_types = self._ordered_key_types(payload.key_types)
        results: list[KeyRotationResultItem] = []
        deleted_old_keys = 0
        disabled_old_keys = 0

        for endpoint_id in payload.endpoint_ids:
            endpoint = by_id[endpoint_id]
            for key_type in selected_types:
                handler_results, deleted_count, disabled_count = self._rotate_by_type(
                    endpoint=endpoint,
                    key_type=key_type,
                    deactivate_only=payload.deactivate_only,
                )
                results.extend(handler_results)
                deleted_old_keys += deleted_count
                disabled_old_keys += disabled_count

        summary = KeyRotationSummary(
            total=len(results),
            rotated=sum(1 for item in results if item.status == "rotated"),
            failed=sum(1 for item in results if item.status == "failed"),
            skipped=sum(1 for item in results if item.status == "skipped"),
            deleted_old_keys=deleted_old_keys,
            disabled_old_keys=disabled_old_keys,
        )
        return KeyRotationResponse(
            mode="deactivate_old_keys" if payload.deactivate_only else "delete_old_keys",
            summary=summary,
            results=results,
        )

    def _ordered_key_types(self, key_types: list[KeyRotationType]) -> list[KeyRotationType]:
        selected = set(key_types)
        return [entry for entry in self._KEY_TYPE_ORDER if entry in selected]

    def _rotate_by_type(self, *, endpoint, key_type, deactivate_only):
        from app.services.durable_key_rotation_service import DurableKeyRotationService, SERVICE_TYPES, pending_rotation
        if endpoint.provider != "ceph":
            return ([self._build_result(endpoint=endpoint, key_type=key_type, target_type="endpoint",
                status="failed", message="Key rotation is only supported for Ceph endpoints.")], 0, 0)
        if key_type in self._ENV_MANAGED_ENDPOINT_KEY_TYPES and not endpoint.is_editable:
            return ([self._build_result(endpoint=endpoint, key_type=key_type, target_type="endpoint",
                status="skipped", message="Admin Ops credentials are managed by ENV_STORAGE_ENDPOINTS; rotate them externally and redeploy.")], 0, 0)
        if key_type.value in SERVICE_TYPES:
            identity = endpoint.service_identity(SERVICE_TYPES[key_type.value])
            if identity is None or identity.mode != "managed":
                return ([self._build_result(endpoint=endpoint, key_type=key_type, target_type="endpoint",
                    status="skipped", message="External service credentials must be rotated by their operator.")], 0, 0)
            targets = [identity]
            target_type = "endpoint"
        elif key_type == KeyRotationType.CEPH_ADMIN:
            identity = endpoint.service_identity("ceph_admin")
            if identity is None or identity.mode != "external":
                return ([self._build_result(endpoint=endpoint, key_type=key_type, target_type="endpoint",
                    status="skipped", message="Ceph Admin credentials are not configured for this endpoint.")], 0, 0)
            targets = [identity]
            target_type = "endpoint"
        elif key_type == KeyRotationType.ACCOUNT:
            targets, target_type = self._list_accounts_for_endpoint(endpoint), "account"
        elif key_type == KeyRotationType.S3_USER:
            targets, target_type = self._list_s3_users_for_endpoint(endpoint), "s3_user"
        else:
            targets, target_type = [endpoint], "endpoint"
        if not targets:
            return ([self._build_result(endpoint=endpoint, key_type=key_type, target_type=target_type,
                status="skipped", message="No persisted identities found for this endpoint.")], 0, 0)
        results, deleted, disabled = [], 0, 0
        rotator = DurableKeyRotationService(self.db, actor=self.actor)
        for target in targets:
            label = getattr(target, "name", None) or endpoint.name
            try:
                old, new, action = rotator.rotate(endpoint, key_type.value, target.id, deactivate_only=deactivate_only)
                deleted += int(action == "deleted")
                disabled += int(action == "disabled")
                results.append(self._build_result(endpoint=endpoint, key_type=key_type, target_type=target_type,
                    target_id=str(endpoint.id if target_type == "endpoint" else target.id), target_label=label,
                    status="rotated", message="Credential rotated and previous key retired.",
                    old_access_key=self._rgw.mask_access_key(old), new_access_key=self._rgw.mask_access_key(new)))
            except (ValueError, RuntimeError) as exc:
                pending = pending_rotation(self.db, endpoint.id, key_type.value, target.id)
                results.append(self._build_result(endpoint=endpoint, key_type=key_type, target_type=target_type,
                    target_id=str(endpoint.id if target_type == "endpoint" else target.id), target_label=label,
                    status="failed", message=sanitized_error_log_detail(exc),
                    rotation_pending=pending is not None, rotation_phase=pending.phase if pending else None))
        return results, deleted, disabled

    def _build_result(
        self,
        *,
        endpoint: StorageEndpoint,
        key_type: KeyRotationType,
        target_type: str,
        status: str,
        target_id: Optional[str] = None,
        target_label: Optional[str] = None,
        message: Optional[str] = None,
        old_access_key: Optional[str] = None,
        new_access_key: Optional[str] = None,
        rotation_pending: bool = False,
        rotation_phase: Optional[str] = None,
    ) -> KeyRotationResultItem:
        return KeyRotationResultItem(
            endpoint_id=int(endpoint.id),
            endpoint_name=endpoint.name or f"#{endpoint.id}",
            key_type=key_type,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            status=status,
            message=message,
            old_access_key=old_access_key,
            new_access_key=new_access_key,
            rotation_pending=rotation_pending,
            rotation_phase=rotation_phase,
        )

    def _list_accounts_for_endpoint(self, endpoint: StorageEndpoint) -> list[S3Account]:
        return self._list_resources_for_endpoint(S3Account, endpoint)

    def _list_s3_users_for_endpoint(self, endpoint: StorageEndpoint) -> list[S3User]:
        return self._list_resources_for_endpoint(S3User, endpoint)

    def _list_resources_for_endpoint(
        self,
        model: type[EndpointResource],
        endpoint: StorageEndpoint,
    ) -> list[EndpointResource]:
        return (
            self.db.query(model)
            .filter(model.storage_endpoint_id == endpoint.id)
            .order_by(model.id.asc())
            .all()
        )

def get_key_rotation_service(db: Session) -> KeyRotationService:
    return KeyRotationService(db)
