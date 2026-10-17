# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.db import S3User
from app.models.ceph_admin import (
    CephAdminRgwAccessKey,
    CephAdminRgwGeneratedAccessKey,
)
from app.services.ceph_admin_audit import record_ceph_admin_action
from app.services.ceph_admin_context import CephAdminContext
from app.services.ceph_admin_user_access import require_user_scope, serialize_access_keys
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.http_errors import raise_http_exception_from_exception


class CephAdminUserKeyService:
    """Orchestrate Ceph Admin RGW user access-key operations."""

    def __init__(self, ctx: CephAdminContext, db: Session):
        self.ctx = ctx
        self.db = db

    def list_keys(
        self,
        uid: str,
        *,
        tenant: Optional[str] = None,
        expected_account_id: Optional[str] = None,
    ) -> list[CephAdminRgwAccessKey]:
        normalized_uid = uid.strip()
        require_user_scope(
            normalized_uid,
            tenant,
            expected_account_id,
            self.ctx.rgw_admin,
        )
        try:
            keys = self.ctx.rgw_admin.list_user_keys(normalized_uid, tenant=tenant)
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)

        serialized = serialize_access_keys(keys)
        for key in serialized:
            provisioning = self._managed_private_key(
                uid=normalized_uid,
                tenant=tenant,
                access_key=key.access_key,
            )
            if provisioning is not None:
                key.is_private_access_managed = True
                key.managed_connection_id = provisioning.s3_connection_id
        return serialized

    def create_key(
        self,
        uid: str,
        *,
        tenant: Optional[str] = None,
        expected_account_id: Optional[str] = None,
    ) -> CephAdminRgwGeneratedAccessKey:
        normalized_uid = uid.strip()
        require_user_scope(
            normalized_uid,
            tenant,
            expected_account_id,
            self.ctx.rgw_admin,
        )
        try:
            response = self.ctx.rgw_admin.create_access_key(normalized_uid, tenant=tenant)
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            self.ctx.rgw_admin.extract_keys(response)
        )
        if not access_key or not secret_key:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="RGW did not return access credentials for this key",
            )
        record_ceph_admin_action(
            self.ctx,
            action="rgw_user_key.create",
            entity_type="rgw_user",
            entity_id=self._entity_id(normalized_uid, tenant),
            metadata={"access_key_suffix": access_key[-4:]},
        )
        return CephAdminRgwGeneratedAccessKey(
            access_key=access_key,
            secret_key=secret_key,
        )

    def update_status(
        self,
        uid: str,
        access_key: str,
        *,
        active: bool,
        tenant: Optional[str] = None,
        expected_account_id: Optional[str] = None,
    ) -> CephAdminRgwAccessKey:
        normalized_uid = uid.strip()
        normalized_key = self._normalize_access_key(access_key)
        if self._managed_private_key(
            uid=normalized_uid,
            tenant=tenant,
            access_key=normalized_key,
        ) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This key belongs to a managed private access; "
                    "update or delete its private connection instead"
                ),
            )
        require_user_scope(
            normalized_uid,
            tenant,
            expected_account_id,
            self.ctx.rgw_admin,
        )
        try:
            self.ctx.rgw_admin.set_access_key_status(
                normalized_uid,
                normalized_key,
                active,
                tenant=tenant,
            )
            keys = self.ctx.rgw_admin.list_user_keys(normalized_uid, tenant=tenant)
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        updated_key = next(
            (key for key in serialize_access_keys(keys) if key.access_key == normalized_key),
            CephAdminRgwAccessKey(
                access_key=normalized_key,
                status="enabled" if active else "suspended",
                is_active=active,
            ),
        )
        record_ceph_admin_action(
            self.ctx,
            action="rgw_user_key.update_status",
            entity_type="rgw_user",
            entity_id=self._entity_id(normalized_uid, tenant),
            metadata={"access_key_suffix": normalized_key[-4:], "active": active},
        )
        return updated_key

    def delete_key(
        self,
        uid: str,
        access_key: str,
        *,
        tenant: Optional[str] = None,
        expected_account_id: Optional[str] = None,
    ) -> None:
        normalized_uid = uid.strip()
        normalized_key = self._normalize_access_key(access_key)
        if self._managed_private_key(
            uid=normalized_uid,
            tenant=tenant,
            access_key=normalized_key,
        ) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This key belongs to a managed private access; "
                    "delete its private connection instead"
                ),
            )
        require_user_scope(
            normalized_uid,
            tenant,
            expected_account_id,
            self.ctx.rgw_admin,
        )
        try:
            self.ctx.rgw_admin.delete_access_key(
                normalized_uid,
                normalized_key,
                tenant=tenant,
            )
        except RGWAdminError as exc:
            raise_http_exception_from_exception(status.HTTP_502_BAD_GATEWAY, exc)
        record_ceph_admin_action(
            self.ctx,
            action="rgw_user_key.delete",
            entity_type="rgw_user",
            entity_id=self._entity_id(normalized_uid, tenant),
            metadata={"access_key_suffix": normalized_key[-4:]},
        )

    def _managed_private_key(
        self,
        *,
        uid: str,
        tenant: Optional[str],
        access_key: str,
    ):
        remote_uids = {uid}
        if tenant:
            remote_uids.add(f"{tenant}${uid}")
        sources = (
            self.db.query(S3User)
            .filter(
                S3User.storage_endpoint_id == self.ctx.endpoint.id,
                S3User.rgw_user_uid.in_(remote_uids),
            )
            .all()
        )
        managed = ManagedPrivateAccessService(self.db)
        for source in sources:
            provisioning = managed.managed_key("s3_user", source.id, access_key)
            if provisioning is not None:
                return provisioning
        return None

    @staticmethod
    def _normalize_access_key(access_key: str) -> str:
        normalized_key = access_key.strip()
        if not normalized_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="access_key is required",
            )
        return normalized_key

    @staticmethod
    def _entity_id(uid: str, tenant: Optional[str]) -> str:
        return f"{tenant}${uid}" if tenant else uid
