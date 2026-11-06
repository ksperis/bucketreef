# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass, replace
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
from app.utils.s3_connection_endpoint import ConnectionEndpointDetails, resolve_connection_details
from app.utils.s3_endpoint import validate_user_supplied_s3_endpoint


S3ConnectionEndpointPayload = (
    S3ConnectionCreate
    | S3ConnectionUpdate
    | S3ConnectionAdminCreate
    | S3ConnectionAdminUpdate
)


_CUSTOM_ENDPOINT_DETAIL_FIELDS = {
    "endpoint_url": "endpoint_url",
    "region": "region",
    "force_path_style": "force_path_style",
    "verify_tls": "verify_tls",
    "provider_hint": "provider",
}


@dataclass(frozen=True)
class S3ConnectionEndpointPlan:
    storage_endpoint_id: int | None
    custom_endpoint_url: str | None
    custom_region: str | None
    custom_force_path_style: bool | None
    custom_verify_tls: bool | None
    custom_provider: str | None

    @classmethod
    def managed(cls, endpoint_id: int) -> "S3ConnectionEndpointPlan":
        return cls(endpoint_id, None, None, None, None, None)

    @classmethod
    def custom(
        cls,
        endpoint_url: str,
        region: str | None,
        force_path_style: bool,
        verify_tls: bool,
        provider: str | None,
    ) -> "S3ConnectionEndpointPlan":
        return cls(
            None,
            endpoint_url,
            region,
            force_path_style,
            verify_tls,
            provider,
        )

    def persistence_values(self) -> dict[str, object]:
        return {
            "storage_endpoint_id": self.storage_endpoint_id,
            "custom_endpoint_url": self.custom_endpoint_url,
            "custom_region": self.custom_region,
            "custom_force_path_style": self.custom_force_path_style,
            "custom_verify_tls": self.custom_verify_tls,
            "custom_provider": self.custom_provider,
        }

    def matches(self, row: DBS3Connection) -> bool:
        return all(
            getattr(row, field) == value
            for field, value in self.persistence_values().items()
        )

    def apply(self, row: DBS3Connection) -> None:
        for field, value in self.persistence_values().items():
            setattr(row, field, value)


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
    ) -> S3ConnectionEndpointPlan:
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
    ) -> S3ConnectionEndpointPlan:
        details = self._custom_endpoint_details(row, payload)
        if details.force_path_style is None or details.verify_tls is None:
            raise ValueError(
                "force_path_style and verify_tls cannot be null for a custom endpoint"
            )
        normalized_endpoint_url = (details.endpoint_url or "").strip().rstrip("/")
        if not normalized_endpoint_url:
            raise ValueError("Endpoint URL is required for manual connections")
        if enforce_manual_endpoint_policy:
            normalized_endpoint_url = self._validate_manual_endpoint(
                normalized_endpoint_url,
                details.verify_tls,
            )
        return S3ConnectionEndpointPlan.custom(
            normalized_endpoint_url,
            self._normalize_optional_text(details.region),
            bool(details.force_path_style),
            bool(details.verify_tls),
            self._normalize_optional_text(details.provider),
        )

    @staticmethod
    def _custom_endpoint_details(
        row: Optional[DBS3Connection],
        payload: S3ConnectionEndpointPayload,
    ) -> ConnectionEndpointDetails:
        current = (
            resolve_connection_details(row)
            if row is not None and row.storage_endpoint_id is None
            else ConnectionEndpointDetails(None, None, False, True, None, None)
        )
        updates = {
            detail_field: getattr(payload, payload_field)
            for payload_field, detail_field in _CUSTOM_ENDPOINT_DETAIL_FIELDS.items()
            if payload_field in payload.model_fields_set
        }
        return replace(current, **updates)

    @staticmethod
    def _normalize_optional_text(value: Optional[str]) -> Optional[str]:
        normalized = (value or "").strip()
        return normalized or None

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
    ) -> S3ConnectionEndpointPlan:
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
        return S3ConnectionEndpointPlan.managed(endpoint_id)

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
