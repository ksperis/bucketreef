# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator

from app.core.domain_enums import ServiceIdentityMode, StorageProvider
from app.models.storage_endpoint import StorageEndpointCoordinates
from app.utils.normalize import normalize_optional_string_field

EndpointKey = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$")]
DEPLOYMENT_FEATURES = frozenset((
    "manager_enabled",
    "openstack_enabled",
    "ceph_admin_enabled",
    "storage_ops_enabled",
    "browser_enabled",
    "portal_enabled",
    "cost_enabled",
    "endpoint_status_enabled",
))


class StorageEndpointDefinition(StorageEndpointCoordinates):
    name: str
    endpoint_url: str
    region: str | None = None
    realm_id: str | None = None
    zonegroup_id: str | None = None
    zone_id: str | None = None
    force_path_style: bool = False
    verify_tls: bool = True
    provider: StorageProvider = StorageProvider.CEPH
    service_identity_mode: ServiceIdentityMode = "managed"
    ceph_admin_allowed: bool = False
    features: dict[str, dict[str, object]] | None = None
    is_default: bool = False

    @model_validator(mode="after")
    def require_explicit_ceph_mode(self):
        if self.provider == StorageProvider.CEPH and "service_identity_mode" not in self.model_fields_set:
            raise ValueError("Ceph deployment endpoints must explicitly declare service_identity_mode.")
        return self

    normalize_string_fields = field_validator(
        "name", "endpoint_url", "region", "realm_id", "zonegroup_id", "zone_id", mode="before",
    )(normalize_optional_string_field)


class ResolvedStorageEndpointDefinition(StorageEndpointDefinition):
    admin_access_key: str | None = None
    admin_secret_key: str | None = None
    runtime_access_key: str | None = None
    runtime_secret_key: str | None = None
    supervision_access_key: str | None = None
    supervision_secret_key: str | None = None
    ceph_admin_access_key: str | None = None
    ceph_admin_secret_key: str | None = None


class CredentialFiles(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_key_file: Path
    secret_key_file: Path

    @field_validator("access_key_file", "secret_key_file")
    @classmethod
    def require_absolute_path(cls, path: Path) -> Path:
        if not path.is_absolute():
            raise ValueError("Credential file paths must be absolute.")
        return path


class DeploymentStorageEndpoint(StorageEndpointDefinition):
    model_config = ConfigDict(extra="forbid")
    key: EndpointKey
    credentials: dict[Literal["admin", "runtime", "supervision", "ceph_admin"], CredentialFiles] = Field(default_factory=dict)

    @field_validator("endpoint_url")
    @classmethod
    def validate_endpoint_url(cls, value: str) -> str:
        try:
            url = urlsplit(value)
            port = url.port
        except ValueError:
            raise ValueError("Endpoint URL must have a valid host and port.") from None
        if (
            url.scheme not in ("http", "https") or not url.hostname
            or url.username is not None or url.password is not None
            or url.query or url.fragment or port == 0
            or any(character.isspace() for character in value)
        ):
            raise ValueError("Use an HTTP(S) endpoint URL without credentials, query or fragment.")
        return value

    def resolve_credentials(self) -> ResolvedStorageEndpointDefinition:
        fields = self.model_dump(exclude={"key", "credentials"})
        for kind, pair in self.credentials.items():
            try:
                access_key = pair.access_key_file.read_text(encoding="utf-8").rstrip("\r\n")
                secret_key = pair.secret_key_file.read_text(encoding="utf-8").rstrip("\r\n")
            except (OSError, UnicodeError):
                raise ValueError(f"Could not read the {kind} credential files for endpoint {self.key}.") from None
            if not access_key.strip() or not secret_key.strip():
                raise ValueError(f"Empty {kind} credential file for endpoint {self.key}.")
            fields.update({f"{kind}_access_key": access_key, f"{kind}_secret_key": secret_key})
        return ResolvedStorageEndpointDefinition.model_validate(fields)


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    values = dict(pairs)
    if len(values) != len(pairs):
        raise ValueError("Duplicate keys are forbidden in the deployment manifest.")
    return values


class DeploymentManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: int = Field(strict=True, ge=1, le=1)
    revision: int = Field(strict=True, ge=1, le=2**63 - 1)
    storage_endpoints: list[DeploymentStorageEndpoint] | None = None
    features: dict[str, StrictBool | None] = Field(default_factory=dict)

    @classmethod
    def from_json(cls, value: str) -> "DeploymentManifest":
        try:
            payload = json.loads(value, object_pairs_hook=_unique_json_object)
        except json.JSONDecodeError:
            raise ValueError("The deployment manifest must be valid JSON.") from None
        return cls.model_validate(payload)

    @model_validator(mode="after")
    def validate_manifest(self):
        if set(self.features) - set(DEPLOYMENT_FEATURES):
            raise ValueError("The manifest contains an unsupported feature.")
        if "storage_endpoints" not in self.model_fields_set and not self.features:
            raise ValueError("The manifest must configure storage_endpoints or features.")
        if self.storage_endpoints is not None:
            keys = {entry.key for entry in self.storage_endpoints}
            if len(keys) != len(self.storage_endpoints):
                raise ValueError("Endpoint keys must be unique.")
        return self
