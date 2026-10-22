# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import StorageEndpointNotFoundError
from app.db.s3_connection import S3Connection as DBS3Connection
from app.db.storage_endpoint import StorageEndpoint
from app.models.s3_connection import (
    S3_CONNECTION_CUSTOM_ENDPOINT_FIELDS,
    S3ConnectionCreate,
    S3ConnectionUpdate,
)
from app.models.s3_connection_admin import (
    S3ConnectionAdminCreate,
    S3ConnectionAdminUpdate,
)
from app.utils.s3_connection_endpoint import (
    build_custom_endpoint_config,
    custom_endpoint_update_base,
)
from app.utils.s3_endpoint import validate_user_supplied_s3_endpoint


S3ConnectionEndpointPayload = (
    S3ConnectionCreate
    | S3ConnectionUpdate
    | S3ConnectionAdminCreate
    | S3ConnectionAdminUpdate
)


class S3ConnectionEndpointPlanner:
    """Resolve one canonical managed or custom endpoint before persistence."""

    def __init__(self, db: Session):
        self.db = db

    def plan(
        self,
        row: Optional[DBS3Connection],
        payload: S3ConnectionEndpointPayload,
        *,
        enforce_manual_endpoint_policy: bool,
    ) -> tuple[Optional[int], Optional[str]]:
        fields_set = payload.model_fields_set
        desired_endpoint_id = self._desired_endpoint_id(row, payload)
        custom_fields = S3_CONNECTION_CUSTOM_ENDPOINT_FIELDS & fields_set
        if desired_endpoint_id is not None:
            return self._managed_endpoint_plan(desired_endpoint_id, custom_fields)
        return self._custom_endpoint_plan(
            row,
            payload,
            enforce_manual_endpoint_policy=enforce_manual_endpoint_policy,
        )

    def _custom_endpoint_plan(
        self,
        row: Optional[DBS3Connection],
        payload: S3ConnectionEndpointPayload,
        *,
        enforce_manual_endpoint_policy: bool,
    ) -> tuple[None, str]:
        fields_set = payload.model_fields_set

        current = custom_endpoint_update_base(
            row.custom_endpoint_config
            if row is not None and row.storage_endpoint_id is None
            else None
        )
        endpoint_url = (
            payload.endpoint_url
            if "endpoint_url" in fields_set
            else current.endpoint_url
        )
        region = payload.region if "region" in fields_set else current.region
        force_path_style = (
            payload.force_path_style
            if "force_path_style" in fields_set
            else current.force_path_style
        )
        verify_tls = (
            payload.verify_tls
            if "verify_tls" in fields_set
            else current.verify_tls
        )
        provider = (
            payload.provider_hint
            if "provider_hint" in fields_set
            else current.provider
        )
        if force_path_style is None or verify_tls is None:
            raise ValueError(
                "force_path_style and verify_tls cannot be null for a custom endpoint"
            )
        normalized_endpoint_url = endpoint_url or ""
        if enforce_manual_endpoint_policy:
            normalized_endpoint_url = self._validate_manual_endpoint(
                normalized_endpoint_url,
                verify_tls,
            )
        return None, build_custom_endpoint_config(
            normalized_endpoint_url,
            region,
            force_path_style,
            verify_tls,
            provider,
        )

    @staticmethod
    def _desired_endpoint_id(
        row: Optional[DBS3Connection],
        payload: S3ConnectionEndpointPayload,
    ) -> Optional[int]:
        if "storage_endpoint_id" in payload.model_fields_set:
            return payload.storage_endpoint_id
        return row.storage_endpoint_id if row is not None else None

    def _managed_endpoint_plan(
        self,
        endpoint_id: int,
        custom_fields: set[str],
    ) -> tuple[int, None]:
        if custom_fields:
            raise ValueError(
                "Custom endpoint fields cannot be combined with a managed storage endpoint"
            )
        endpoint = self.db.scalar(
            select(StorageEndpoint)
            .where(StorageEndpoint.id == endpoint_id)
            .limit(1)
        )
        if endpoint is None:
            raise StorageEndpointNotFoundError("Storage endpoint not found")
        return endpoint_id, None

    @staticmethod
    def _validate_manual_endpoint(
        endpoint_url: Optional[str],
        verify_tls: bool,
    ) -> str:
        normalized = (endpoint_url or "").strip()
        if not normalized:
            raise ValueError("Endpoint URL is required.")
        if not verify_tls:
            raise ValueError("Manual private connections require TLS verification.")
        return validate_user_supplied_s3_endpoint(
            normalized,
            field_name="Endpoint URL",
        )
