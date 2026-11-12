# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.domain_errors import S3AccessKeyNotFoundError, S3UserNotFoundError
from app.models.s3_user import S3UserAccessKey, S3UserGeneratedKey
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.rgw_payloads import require_rgw_user_identity


class S3UserAccessKeyService:
    """Manage remote RGW access keys for an S3 user execution context."""

    @staticmethod
    def _identity(context: S3ExecutionContext) -> tuple[str, str, str]:
        uid = context.rgw_user_uid
        interface_access_key = context.access_key
        if not uid or not interface_access_key:
            raise ValueError("S3 user execution context is missing its RGW identity")
        return uid, context.rgw_tenant or "", interface_access_key

    @staticmethod
    def _mutable_access_key(
        access_key: str,
        *,
        interface_access_key: str,
        action: str,
    ) -> str:
        normalized = (access_key or "").strip()
        if not normalized:
            raise ValueError("access_key is required")
        if normalized == interface_access_key:
            raise ValueError(f"Cannot {action} the interface access key; rotate it instead")
        return normalized

    def list_keys(
        self,
        context: S3ExecutionContext,
        admin: RGWAdminClient,
    ) -> list[S3UserAccessKey]:
        uid, tenant, interface_access_key = self._identity(context)
        try:
            user_info = admin.get_user(
                uid,
                tenant=tenant or None,
                allow_not_found=True,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to list keys: {exc}") from exc
        if not user_info or user_info.get("not_found"):
            raise S3UserNotFoundError("RGW user not found")
        require_rgw_user_identity(user_info, uid, tenant)
        return RgwUserKeyParser.to_access_keys(
            admin.extract_keys(user_info),
            ui_managed_access_key=interface_access_key,
        )

    def create_key(
        self,
        context: S3ExecutionContext,
        admin: RGWAdminClient,
    ) -> S3UserGeneratedKey:
        uid, tenant, _interface_access_key = self._identity(context)
        existing_access_keys: set[str] = set()
        try:
            before_payload = admin.get_user(
                uid,
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
                require_rgw_user_identity(before_payload, uid, tenant)
            response = admin.create_access_key(
                uid,
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
        context: S3ExecutionContext,
        admin: RGWAdminClient,
        access_key: str,
        active: bool,
    ) -> S3UserAccessKey:
        uid, tenant, interface_access_key = self._identity(context)
        normalized = self._mutable_access_key(
            access_key,
            interface_access_key=interface_access_key,
            action="disable",
        )
        try:
            admin.set_access_key_status(
                uid,
                normalized,
                active,
                tenant=tenant or None,
            )
        except RGWAdminError as exc:
            if exc.status_code == 404:
                raise S3AccessKeyNotFoundError("Access key not found") from exc
            raise ValueError(f"Unable to update access key status: {exc}") from exc
        for key in self.list_keys(context, admin):
            if key.access_key_id == normalized:
                return key
        raise S3AccessKeyNotFoundError("Access key not found after status update")

    def delete_key(
        self,
        context: S3ExecutionContext,
        admin: RGWAdminClient,
        access_key: str,
    ) -> None:
        uid, tenant, interface_access_key = self._identity(context)
        normalized = self._mutable_access_key(
            access_key,
            interface_access_key=interface_access_key,
            action="delete",
        )
        try:
            admin.delete_access_key(
                uid,
                normalized,
                tenant=tenant or None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"Unable to delete access key: {exc}") from exc
