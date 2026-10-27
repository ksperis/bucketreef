# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import math
from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from pydantic import ConfigDict, Field, SecretStr, field_validator, model_validator

from app.models.base import ApiModel
from app.db import StorageProvider
from app.models.tagging import RequiredTagDefinitionList, TagDefinitionSummary
from app.utils.normalize import normalize_optional_string_field


def validate_multisite_id_value(value: Optional[str]) -> Optional[str]:
    normalized = normalize_optional_string_field(value)
    if normalized is None:
        return None
    try:
        parsed = UUID(normalized)
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValueError("Multisite IDs must be canonical UUIDs.") from exc
    if str(parsed) != normalized:
        raise ValueError("Multisite IDs must be lowercase canonical UUIDs.")
    return normalized


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
    users_read: bool
    users_write: bool
    buckets_read: bool
    buckets_write: bool
    accounts_read: bool
    accounts_write: bool
    usage_read: bool
    usage_write: bool

    @classmethod
    def empty(cls) -> "StorageEndpointAdminOpsPermissions":
        return cls(
            users_read=False,
            users_write=False,
            buckets_read=False,
            buckets_write=False,
            accounts_read=False,
            accounts_write=False,
            usage_read=False,
            usage_write=False,
        )


class EndpointServiceIdentityStatus(ApiModel):
    kind: Literal["runtime", "supervision", "ceph_admin"]
    mode: Literal["managed", "external"]
    rgw_uid: Optional[str]
    status: Literal[
        "not_provisioned",
        "missing",
        "provisioning",
        "ready",
        "error",
        "revocation_pending",
        "disabled",
    ]
    credentials_configured: bool
    rotation_pending: bool
    rotation_phase: Optional[Literal["prepared", "activated"]]
    last_error: Optional[str]
    last_reconciled_at: Optional[datetime]


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
    multisite_realm_id: Optional[str] = None
    multisite_zonegroup_id: Optional[str] = None
    multisite_zone_id: Optional[str] = None
    multisite_diagnostic: bool = False

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

    @field_validator("multisite_realm_id", "multisite_zonegroup_id", "multisite_zone_id", mode="before")
    @classmethod
    def validate_multisite_id(cls, value: Optional[str]) -> Optional[str]:
        return validate_multisite_id_value(value)

    @model_validator(mode="after")
    def validate_multisite_association(self):
        ids = (self.multisite_realm_id, self.multisite_zonegroup_id, self.multisite_zone_id)
        if any(ids) and not all(ids):
            raise ValueError("Multisite realm, zonegroup and zone IDs must be provided together.")
        if self.multisite_diagnostic and not all(ids):
            raise ValueError("A diagnostic endpoint requires a complete multisite association.")
        if any(ids) and self.provider != StorageProvider.CEPH:
            raise ValueError("Multisite associations are only supported for Ceph endpoints.")
        return self


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
    multisite_realm_id: Optional[str] = None
    multisite_zonegroup_id: Optional[str] = None
    multisite_zone_id: Optional[str] = None
    multisite_diagnostic: Optional[bool] = None

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

    @field_validator("multisite_realm_id", "multisite_zonegroup_id", "multisite_zone_id", mode="before")
    @classmethod
    def validate_optional_multisite_id(cls, value: Optional[str]) -> Optional[str]:
        return validate_multisite_id_value(value)


class StorageEndpointTagsUpdate(ApiModel):
    tags: RequiredTagDefinitionList


class StorageEndpoint(StorageEndpointMetadata):
    model_config = ConfigDict(from_attributes=True)

    id: int
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool
    provider: StorageProvider
    ceph_admin_allowed: bool
    features_config: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    multisite_realm_id: Optional[str]
    multisite_zonegroup_id: Optional[str]
    multisite_zone_id: Optional[str]
    multisite_diagnostic: bool
    is_default: bool
    is_editable: bool
    created_at: datetime
    updated_at: datetime
    tags: list[TagDefinitionSummary]
    admin_access_key: Optional[str]
    has_admin_secret: bool
    service_identities: list[EndpointServiceIdentityStatus]
    ceph_admin_active: bool
    capabilities: dict[str, bool]
    admin_ops_permissions: StorageEndpointAdminOpsPermissions
    features: StorageEndpointFeatures


class StorageEndpointPublic(ApiModel):
    id: int
    name: str
    endpoint_url: str
    is_default: bool


class StorageEndpointMeta(ApiModel):
    managed_by_env: bool


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
        default_factory=StorageEndpointAdminOpsPermissions.empty
    )
    credential_checks: StorageEndpointCredentialChecks = Field(
        default_factory=StorageEndpointCredentialChecks
    )
