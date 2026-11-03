# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.domain_errors import S3AccessKeyNotFoundError, S3UserNotFoundError
from app.db import S3User
from app.models.s3_user import S3UserAccessKey, S3UserGeneratedKey
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.utils.rgw_payloads import require_rgw_user_identity


class S3UserAccessKeyService:
    """Manage remote RGW access keys for a persisted S3 user."""

    @staticmethod
    def _tenant(s3_user: S3User) -> str:
        return s3_user.rgw_tenant

    @staticmethod
    def _mutable_access_key(s3_user: S3User, access_key: str, *, action: str) -> str:
        normalized = (access_key or "").strip()
        if not normalized:
            raise ValueError("access_key is required")
        if normalized == s3_user.rgw_access_key:
            raise ValueError(f"Cannot {action} the interface access key; rotate it instead")
        return normalized

    def list_keys(
        self,
        s3_user: S3User,
        admin: RGWAdminClient,
    ) -> list[S3UserAccessKey]:
        tenant = self._tenant(s3_user)
        try:
            user_info = admin.get_user(
                s3_user.rgw_user_uid,
                tenant=tenant or None,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to list keys: {exc}") from exc
        if not user_info or user_info.get("not_found"):
            raise S3UserNotFoundError("RGW user not found")
        require_rgw_user_identity(user_info, s3_user.rgw_user_uid, tenant)
        return RgwUserKeyParser.to_access_keys(
            admin.extract_keys(user_info),
            ui_managed_access_key=s3_user.rgw_access_key,
        )

    def create_key(
        self,
        s3_user: S3User,
        admin: RGWAdminClient,
    ) -> S3UserGeneratedKey:
        tenant = self._tenant(s3_user)
        existing_access_keys: set[str] = set()
        try:
            before_payload = admin.get_user(
                s3_user.rgw_user_uid,
                tenant=tenant or None,
                allow_not_found=True,
            )
            if before_payload and not before_payload.get("not_found"):
                existing_access_keys = RgwUserKeyParser.access_key_ids(
                    admin.extract_keys(before_payload)
                )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to verify RGW user before key creation: {exc}") from exc
        try:
            if before_payload:
                require_rgw_user_identity(before_payload, s3_user.rgw_user_uid, tenant)
            response = admin.create_access_key(
                s3_user.rgw_user_uid,
                tenant=tenant or None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to create access key: {exc}") from exc
        if isinstance(response, dict) and response.get("not_found"):
            raise S3UserNotFoundError("RGW user not found")
        key = RgwUserKeyParser.to_generated_key(
            admin.extract_keys(response),
            existing_access_keys=existing_access_keys,
        )
        return key

    def set_key_status(
        self,
        s3_user: S3User,
        admin: RGWAdminClient,
        access_key: str,
        active: bool,
    ) -> S3UserAccessKey:
        tenant = self._tenant(s3_user)
        normalized = self._mutable_access_key(s3_user, access_key, action="disable")
        try:
            admin.set_access_key_status(
                s3_user.rgw_user_uid,
                normalized,
                active,
                tenant=tenant or None,
            )
        except RGWAdminError as exc:
            if exc.status_code == 404:
                raise S3AccessKeyNotFoundError("Access key not found") from exc
            raise ValueError(f"Unable to update access key status: {exc}") from exc
        for key in self.list_keys(s3_user, admin):
            if key.access_key_id == normalized:
                return key
        raise S3AccessKeyNotFoundError("Access key not found after status update")

    def delete_key(
        self,
        s3_user: S3User,
        admin: RGWAdminClient,
        access_key: str,
    ) -> None:
        tenant = self._tenant(s3_user)
        normalized = self._mutable_access_key(s3_user, access_key, action="delete")
        try:
            admin.delete_access_key(
                s3_user.rgw_user_uid,
                normalized,
                tenant=tenant or None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to delete access key: {exc}") from exc
