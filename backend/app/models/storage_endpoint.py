# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import math
from datetime import datetime
from typing import Literal, Optional

from pydantic import ConfigDict, Field, SecretStr, field_validator

from app.models.base import ApiModel
from app.db import StorageProvider
from app.models.tagging import RequiredTagDefinitionList, TagDefinitionSummary
from app.utils.normalize import normalize_optional_string_field


class StorageEndpointFeature(ApiModel):
    enabled: bool = False
    endpoint: Optional[str] = None


class StorageEndpointHealthcheckFeature(ApiModel):
    enabled: bool = True
    mode: Literal["http", "s3"] = "http"
    url: Optional[str] = None


class StorageEndpointFeatures(ApiModel):
    admin: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    account: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    sts: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    usage: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    metrics: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    static_website: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    iam: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    sns: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    sse: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    replication: StorageEndpointFeature = Field(default_factory=StorageEndpointFeature)
    healthcheck: StorageEndpointHealthcheckFeature = Field(default_factory=StorageEndpointHealthcheckFeature)


class StorageEndpointAdminOpsPermissions(ApiModel):
    users_read: bool = False
    users_write: bool = False
    buckets_read: bool = False
    buckets_write: bool = False
    accounts_read: bool = False
    accounts_write: bool = False
    usage_read: bool = False
    usage_write: bool = False


class EndpointServiceIdentityStatus(ApiModel):
    kind: Literal["runtime", "supervision", "ceph_admin"]
    mode: Literal["managed", "external"]
    rgw_uid: Optional[str] = None
    status: Literal[
        "not_provisioned",
        "missing",
        "provisioning",
        "ready",
        "error",
        "revocation_pending",
        "disabled",
    ]
    credentials_configured: bool = False
    rotation_pending: bool = False
    rotation_phase: Optional[Literal["prepared", "activated"]] = None
    last_error: Optional[str] = None
    last_reconciled_at: Optional[datetime] = None


class StorageEndpointMetadata(ApiModel):
    name: str
    endpoint_url: str
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    provider: StorageProvider = Field(default=StorageProvider.CEPH)
    ceph_admin_allowed: bool = False
    features_config: Optional[str] = None
    latitude: Optional[float] = Field(default=None)
    longitude: Optional[float] = Field(default=None)

    normalize_string_fields = field_validator("name", "endpoint_url", "region", mode="before")(
        normalize_optional_string_field
    )

    @field_validator("latitude")
    @classmethod
    def validate_latitude(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if not math.isfinite(value) or value < -90 or value > 90:
            raise ValueError("Latitude must be a finite number between -90 and 90.")
        return value

    @field_validator("longitude")
    @classmethod
    def validate_longitude(cls, value: Optional[float]) -> Optional[float]:
        if value is None:
            return None
        if not math.isfinite(value) or value < -180 or value > 180:
            raise ValueError("Longitude must be a finite number between -180 and 180.")
        return value


class StorageEndpointCreate(StorageEndpointMetadata):
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[SecretStr] = None
    service_identity_mode: Literal["managed", "external"] = "managed"
    runtime_access_key: Optional[str] = None
    runtime_secret_key: Optional[SecretStr] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[SecretStr] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[SecretStr] = None


class StorageEndpointUpdate(ApiModel):
    name: Optional[str] = None
    endpoint_url: Optional[str] = None
    region: Optional[str] = None
    force_path_style: Optional[bool] = None
    verify_tls: Optional[bool] = None
    provider: Optional[StorageProvider] = None
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[SecretStr] = None
    service_identity_mode: Optional[Literal["managed", "external"]] = None
    runtime_access_key: Optional[str] = None
    runtime_secret_key: Optional[SecretStr] = None
    ceph_admin_allowed: Optional[bool] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[SecretStr] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[SecretStr] = None
    features_config: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    normalize_string_fields = field_validator("name", "endpoint_url", "region", mode="before")(
        normalize_optional_string_field
    )

    @field_validator("latitude")
    @classmethod
    def validate_optional_latitude(cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointMetadata.validate_latitude(value)

    @field_validator("longitude")
    @classmethod
    def validate_optional_longitude(cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointMetadata.validate_longitude(value)


class StorageEndpointTagsUpdate(ApiModel):
    tags: RequiredTagDefinitionList = Field(default_factory=list)


class StorageEndpoint(StorageEndpointMetadata):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: StorageProvider
    is_default: bool = False
    is_editable: bool = True
    created_at: datetime
    updated_at: datetime
    tags: list[TagDefinitionSummary] = Field(default_factory=list)
    admin_access_key: Optional[str] = None
    has_admin_secret: bool = False
    service_identities: list[EndpointServiceIdentityStatus] = Field(default_factory=list)
    ceph_admin_active: bool = False
    capabilities: dict[str, bool] = Field(default_factory=dict)
    admin_ops_permissions: StorageEndpointAdminOpsPermissions = Field(
        default_factory=StorageEndpointAdminOpsPermissions
    )
    features_config: Optional[str] = None
    features: StorageEndpointFeatures = Field(default_factory=StorageEndpointFeatures)


class StorageEndpointPublic(ApiModel):
    id: int
    name: str
    endpoint_url: str
    is_default: bool = False


class StorageEndpointMeta(ApiModel):
    managed_by_env: bool = False


class StorageEndpointFeatureDetectionRequest(ApiModel):
    endpoint_id: Optional[int] = None
    endpoint_url: str
    admin_endpoint: Optional[str] = None
    region: Optional[str] = None
    verify_tls: Optional[bool] = None
    check_http: bool = False
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[SecretStr] = None
    runtime_access_key: Optional[str] = None
    runtime_secret_key: Optional[SecretStr] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[SecretStr] = None
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[SecretStr] = None

    normalize_string_fields = field_validator(
        "endpoint_url",
        "admin_endpoint",
        "region",
        "admin_access_key",
        "admin_secret_key",
        "ceph_admin_access_key",
        "ceph_admin_secret_key",
        "runtime_access_key",
        "runtime_secret_key",
        "supervision_access_key",
        "supervision_secret_key",
        mode="before",
    )(normalize_optional_string_field)


class StorageEndpointCredentialCheck(ApiModel):
    status: Literal[
        "valid",
        "denied",
        "unavailable",
        "misconfigured",
        "incomplete",
        "not_configured",
    ] = "not_configured"
    message: Optional[str] = None


class StorageEndpointCredentialChecks(ApiModel):
    ceph_admin: StorageEndpointCredentialCheck = Field(default_factory=StorageEndpointCredentialCheck)
    runtime: StorageEndpointCredentialCheck = Field(default_factory=StorageEndpointCredentialCheck)
    admin: StorageEndpointCredentialCheck = Field(
        default_factory=StorageEndpointCredentialCheck
    )
    supervision: StorageEndpointCredentialCheck = Field(
        default_factory=StorageEndpointCredentialCheck
    )


class StorageEndpointHttpCheck(ApiModel):
    status: Literal["not_checked", "valid", "unavailable"] = "not_checked"
    status_code: Optional[int] = None
    message: Optional[str] = None


class StorageEndpointFeatureDetectionResult(ApiModel):
    admin: bool = False
    account: bool = False
    usage: bool = False
    metrics: bool = False
    admin_error: Optional[str] = None
    account_error: Optional[str] = None
    metrics_error: Optional[str] = None
    usage_error: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)
    http_check: StorageEndpointHttpCheck = Field(
        default_factory=StorageEndpointHttpCheck
    )
    admin_ops_permissions: StorageEndpointAdminOpsPermissions = Field(
        default_factory=StorageEndpointAdminOpsPermissions
    )
    credential_checks: StorageEndpointCredentialChecks = Field(
        default_factory=StorageEndpointCredentialChecks
    )
