# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from dataclasses import dataclass, replace
from typing import Literal, Optional

import yaml
from pydantic import SecretStr, ValidationError, field_validator, model_validator

from app.db import StorageEndpoint, StorageProvider
from app.models.base import ApiModel
from app.models.storage_endpoint import (
    StorageEndpointCreate,
    StorageEndpointMetadata,
    StorageEndpointUpdate,
)
from app.utils.normalize import (
    normalize_optional_string,
    normalize_optional_string_field,
    normalize_storage_provider,
)
from app.utils.s3_endpoint import normalize_s3_endpoint
from app.utils.storage_endpoint_features import (
    AWS_DEFAULT_REGION,
    dump_features_config,
    normalize_features_config,
    required_service_identity_kinds,
)

_EndpointCredentialValues = tuple[
    Optional[str],
    Optional[str],
    Optional[str],
    Optional[str],
]
_CREDENTIAL_FIELD_PAIRS = (
    ("admin_access_key", "admin_secret_key"),
    ("runtime_access_key", "runtime_secret_key"),
    ("supervision_access_key", "supervision_secret_key"),
    ("ceph_admin_access_key", "ceph_admin_secret_key"),
)
_PRESERVE_EXISTING_ON_NULL_UPDATE_FIELDS = frozenset(
    {
        "features_config",
        "force_path_style",
        "name",
        "verify_tls",
    }
)


class EnvStorageEndpoint(ApiModel):
    name: str
    endpoint_url: str
    region: Optional[str] = None
    force_path_style: bool = False
    verify_tls: bool = True
    provider: StorageProvider = StorageProvider.CEPH
    admin_access_key: Optional[str] = None
    admin_secret_key: Optional[str] = None
    service_identity_mode: Literal["managed", "external"] = "managed"
    runtime_access_key: Optional[str] = None
    runtime_secret_key: Optional[str] = None
    ceph_admin_access_key: Optional[str] = None
    ceph_admin_secret_key: Optional[str] = None
    ceph_admin_allowed: bool = False
    supervision_access_key: Optional[str] = None
    supervision_secret_key: Optional[str] = None
    features_config: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    features: Optional[dict[str, dict[str, object]]] = None
    is_default: bool = False

    @model_validator(mode="after")
    def require_explicit_ceph_mode(self):
        if self.provider == StorageProvider.CEPH and "service_identity_mode" not in self.model_fields_set:
            raise ValueError("Ceph ENV endpoints must explicitly declare service_identity_mode.")
        return self

    normalize_string_fields = field_validator("name", "endpoint_url", "region", mode="before")(
        normalize_optional_string_field
    )

    @field_validator("latitude")
    @classmethod
    def validate_latitude(_cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointMetadata.validate_latitude(value)

    @field_validator("longitude")
    @classmethod
    def validate_longitude(_cls, value: Optional[float]) -> Optional[float]:
        return StorageEndpointMetadata.validate_longitude(value)


@dataclass(frozen=True)
class NormalizedEndpointState:
    name: str
    endpoint_url: str
    region: Optional[str]
    force_path_style: bool
    verify_tls: bool
    latitude: Optional[float]
    longitude: Optional[float]
    provider: StorageProvider
    admin_access_key: Optional[str]
    admin_secret_key: Optional[str]
    service_identity_mode: str | None
    runtime_access_key: Optional[str]
    runtime_secret_key: Optional[str]
    ceph_admin_access_key: Optional[str]
    ceph_admin_secret_key: Optional[str]
    ceph_admin_allowed: bool | None
    supervision_access_key: Optional[str]
    supervision_secret_key: Optional[str]
    features_config: str
    is_default: bool = False


@dataclass(frozen=True)
class _EnvEndpointIdentity:
    entry: EnvStorageEndpoint
    name: str
    endpoint_url: str
    is_default: bool


def parse_env_storage_endpoints(raw: str | None) -> list[EnvStorageEndpoint]:
    if not raw or not raw.strip():
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("ENV_STORAGE_ENDPOINTS must be valid JSON.") from exc
    if not isinstance(payload, list):
        raise ValueError("ENV_STORAGE_ENDPOINTS must be a JSON array.")

    endpoints: list[EnvStorageEndpoint] = []
    for index, entry in enumerate(payload):
        try:
            endpoints.append(EnvStorageEndpoint.model_validate(entry))
        except ValidationError as exc:
            raise ValueError(
                f"Invalid ENV_STORAGE_ENDPOINTS entry at index {index}."
            ) from None
    return endpoints


def _normalize_name(value: Optional[str], fallback: str = "Endpoint") -> str:
    normalized = (value or fallback).strip()
    return normalized or fallback


def _secret_value(value: SecretStr | str | None) -> str | None:
    return value.get_secret_value() if isinstance(value, SecretStr) else value


def _normalize_region(
    provider: StorageProvider,
    value: Optional[str],
) -> Optional[str]:
    region = normalize_optional_string(value)
    if provider == StorageProvider.AWS and not region:
        return AWS_DEFAULT_REGION
    return region


def _validate_credentials(
    provider: StorageProvider,
    admin_access_key: Optional[str],
    admin_secret_key: Optional[str],
    supervision_access_key: Optional[str],
    supervision_secret_key: Optional[str],
    admin_enabled: bool,
    supervision_required: bool,
) -> _EndpointCredentialValues:
    if provider == StorageProvider.CEPH:
        if admin_enabled and (not admin_access_key or not admin_secret_key):
            raise ValueError(
                "Ceph endpoints with admin enabled require an admin access key and secret key."
            )
        if supervision_required and (
            not supervision_access_key or not supervision_secret_key
        ):
            raise ValueError(
                "External service identities require Supervision access key and secret key."
            )
        return (
            admin_access_key,
            admin_secret_key,
            supervision_access_key,
            supervision_secret_key,
        )
    return None, None, None, None


def normalize_storage_endpoint_state(
    payload: StorageEndpointCreate,
) -> NormalizedEndpointState:
    name = _normalize_name(payload.name)
    endpoint_url = normalize_s3_endpoint(payload.endpoint_url)
    if not endpoint_url:
        raise ValueError("Endpoint URL is required.")
    provider = normalize_storage_provider(payload.provider)
    region = _normalize_region(provider, payload.region)
    features = normalize_features_config(
        provider,
        payload.features_config,
        region,
    )
    supervision_access_input = normalize_optional_string(payload.supervision_access_key)
    supervision_secret_input = normalize_optional_string(
        _secret_value(payload.supervision_secret_key)
    )
    if (
        provider == StorageProvider.CEPH
        and payload.service_identity_mode == "external"
        and supervision_access_input
        and supervision_secret_input
    ):
        features["healthcheck"]["enabled"] = True
        features["healthcheck"]["mode"] = "s3"
    features_config = dump_features_config(features)
    admin_enabled = bool(features.get("admin", {}).get("enabled")) or bool(
        features.get("account", {}).get("enabled")
    )
    required_identities = required_service_identity_kinds(features)
    admin_required = admin_enabled or (
        payload.service_identity_mode == "managed" and bool(required_identities)
    )
    (
        admin_access_key,
        admin_secret_key,
        supervision_access_key,
        supervision_secret_key,
    ) = _validate_credentials(
        provider,
        normalize_optional_string(payload.admin_access_key),
        normalize_optional_string(_secret_value(payload.admin_secret_key)),
        supervision_access_input,
        supervision_secret_input,
        admin_required,
        payload.service_identity_mode == "external" and "supervision" in required_identities,
    )
    runtime_access = normalize_optional_string(payload.runtime_access_key) if provider == StorageProvider.CEPH else None
    runtime_secret = normalize_optional_string(_secret_value(payload.runtime_secret_key)) if provider == StorageProvider.CEPH else None
    if provider == StorageProvider.CEPH and payload.service_identity_mode == "external" and "runtime" in required_identities and (not runtime_access or not runtime_secret):
        raise ValueError("External service identities require Runtime access key and secret key.")
    if provider == StorageProvider.CEPH:
        for kind in ("admin", "runtime", "supervision", "ceph_admin"):
            access, secret = getattr(payload, f"{kind}_access_key"), _secret_value(getattr(payload, f"{kind}_secret_key"))
            if bool(normalize_optional_string(access)) != bool(normalize_optional_string(secret)):
                raise ValueError(f"External {kind} credentials require a complete pair.")
        if payload.ceph_admin_allowed and (
            not normalize_optional_string(payload.ceph_admin_access_key)
            or not normalize_optional_string(_secret_value(payload.ceph_admin_secret_key))
        ):
            raise ValueError("Allowing Ceph Admin requires its access key and secret key.")
    return NormalizedEndpointState(
        name=name,
        endpoint_url=endpoint_url,
        region=region,
        force_path_style=bool(payload.force_path_style),
        verify_tls=bool(payload.verify_tls),
        latitude=payload.latitude,
        longitude=payload.longitude,
        provider=provider,
        admin_access_key=admin_access_key,
        admin_secret_key=admin_secret_key,
        service_identity_mode=payload.service_identity_mode,
        runtime_access_key=runtime_access,
        runtime_secret_key=runtime_secret,
        ceph_admin_access_key=normalize_optional_string(payload.ceph_admin_access_key) if provider == StorageProvider.CEPH else None,
        ceph_admin_secret_key=normalize_optional_string(_secret_value(payload.ceph_admin_secret_key)) if provider == StorageProvider.CEPH else None,
        ceph_admin_allowed=payload.ceph_admin_allowed if provider == StorageProvider.CEPH else False,
        supervision_access_key=supervision_access_key,
        supervision_secret_key=supervision_secret_key,
        features_config=features_config,
    )


def normalize_storage_endpoint_update(
    endpoint: StorageEndpoint,
    payload: StorageEndpointUpdate,
) -> NormalizedEndpointState:
    fields_set = set(payload.model_fields_set)
    ceph_pair = {"ceph_admin_access_key", "ceph_admin_secret_key"}
    if ceph_pair & fields_set and not normalize_optional_string(payload.ceph_admin_access_key) and not normalize_optional_string(_secret_value(payload.ceph_admin_secret_key)):
        fields_set -= ceph_pair  # Empty write-only fields preserve the stored pair.
    runtime = endpoint.service_identity("runtime")
    supervision = endpoint.service_identity("supervision")
    ceph_admin = endpoint.service_identity("ceph_admin")
    current_identity_mode = runtime.mode if runtime is not None else "managed"
    merged = StorageEndpointCreate(
        name=endpoint.name,
        endpoint_url=endpoint.endpoint_url,
        region=endpoint.region,
        force_path_style=endpoint.force_path_style,
        verify_tls=endpoint.verify_tls,
        provider=StorageProvider(endpoint.provider),
        admin_access_key=endpoint.admin_access_key,
        admin_secret_key=endpoint.admin_secret_key,
        service_identity_mode=current_identity_mode,
        runtime_access_key=runtime.access_key if runtime is not None else None,
        runtime_secret_key=runtime.secret_key if runtime is not None else None,
        ceph_admin_access_key=ceph_admin.access_key if ceph_admin is not None else None,
        ceph_admin_secret_key=ceph_admin.secret_key if ceph_admin is not None else None,
        ceph_admin_allowed=endpoint.ceph_admin_allowed,
        supervision_access_key=supervision.access_key if supervision is not None else None,
        supervision_secret_key=supervision.secret_key if supervision is not None else None,
        features_config=endpoint.features_config,
        latitude=endpoint.latitude,
        longitude=endpoint.longitude,
    ).model_dump()
    if current_identity_mode == "managed" and payload.service_identity_mode == "external":
        for kind in ("runtime", "supervision"):
            merged[f"{kind}_access_key"] = None
            merged[f"{kind}_secret_key"] = None
    for field in fields_set:
        value = getattr(payload, field)
        if (
            value is None
            and field in _PRESERVE_EXISTING_ON_NULL_UPDATE_FIELDS
        ):
            continue
        merged[field] = value

    if current_identity_mode == "managed" and payload.service_identity_mode == "external":
        required = required_service_identity_kinds(normalize_features_config(
            merged["provider"], merged["features_config"], merged["region"],
        ))
        for kind, identity in (("runtime", runtime), ("supervision", supervision)):
            existing_managed = identity is not None and identity.mode == "managed" and any((
                identity.rgw_uid, identity.access_key, identity.secret_key, identity.provenance,
            ))
            if (kind in required or existing_managed) and (
                not normalize_optional_string(getattr(payload, f"{kind}_access_key"))
                or not normalize_optional_string(_secret_value(getattr(payload, f"{kind}_secret_key")))
            ):
                raise ValueError(f"Switching to external mode requires replacement {kind.title()} credentials.")

    if not merged["endpoint_url"]:
        raise ValueError("Endpoint URL is required.")
    for kind in ("runtime", "supervision", "ceph_admin"):
        access_field, secret_field = f"{kind}_access_key", f"{kind}_secret_key"
        if {access_field, secret_field} & fields_set:
            if bool(normalize_optional_string(getattr(payload, access_field))) != bool(normalize_optional_string(_secret_value(getattr(payload, secret_field)))):
                raise ValueError(f"Replacing {kind} credentials requires a complete pair.")
    for access_key_field, secret_key_field in _CREDENTIAL_FIELD_PAIRS:
        if (
            access_key_field in fields_set
            and not normalize_optional_string(merged[access_key_field])
        ):
            merged[secret_key_field] = None

    return normalize_storage_endpoint_state(StorageEndpointCreate.model_validate(merged))


def _env_endpoint_identities(
    env_endpoints: list[EnvStorageEndpoint],
) -> list[_EnvEndpointIdentity]:
    seen_urls: set[str] = set()
    seen_names: set[str] = set()
    default_count = 0
    identities: list[_EnvEndpointIdentity] = []
    for entry in env_endpoints:
        name = _normalize_name(entry.name)
        endpoint_url = normalize_s3_endpoint(entry.endpoint_url)
        if not endpoint_url:
            raise ValueError(
                "ENV_STORAGE_ENDPOINTS requires endpoint_url for each entry."
            )
        if endpoint_url in seen_urls:
            raise ValueError(
                f"ENV_STORAGE_ENDPOINTS contains duplicate endpoint_url: {endpoint_url}"
            )
        if name in seen_names:
            raise ValueError(
                f"ENV_STORAGE_ENDPOINTS contains duplicate name: {name}"
            )
        seen_urls.add(endpoint_url)
        seen_names.add(name)
        if entry.is_default:
            default_count += 1
        identities.append(
            _EnvEndpointIdentity(
                entry=entry,
                name=name,
                endpoint_url=endpoint_url,
                is_default=bool(entry.is_default),
            )
        )

    if not identities:
        return []
    if default_count > 1:
        raise ValueError(
            "ENV_STORAGE_ENDPOINTS can only define one default endpoint."
        )
    if default_count == 0:
        first = identities[0]
        identities[0] = replace(first, is_default=True)
    return identities


def normalize_env_storage_endpoint_states(
    env_endpoints: list[EnvStorageEndpoint],
) -> list[NormalizedEndpointState]:
    states: list[NormalizedEndpointState] = []
    for identity in _env_endpoint_identities(env_endpoints):
        entry = identity.entry
        raw_features = (
            yaml.safe_dump(
                {"features": entry.features},
                sort_keys=False,
                default_flow_style=False,
            ).strip()
            if entry.features is not None
            else entry.features_config
        )
        state = normalize_storage_endpoint_state(
            StorageEndpointCreate(
                name=identity.name,
                endpoint_url=identity.endpoint_url,
                region=entry.region,
                force_path_style=entry.force_path_style,
                verify_tls=entry.verify_tls,
                provider=entry.provider,
                admin_access_key=entry.admin_access_key,
                admin_secret_key=entry.admin_secret_key,
                service_identity_mode=entry.service_identity_mode,
                runtime_access_key=entry.runtime_access_key,
                runtime_secret_key=entry.runtime_secret_key,
                ceph_admin_access_key=entry.ceph_admin_access_key,
                ceph_admin_secret_key=entry.ceph_admin_secret_key,
                ceph_admin_allowed=entry.ceph_admin_allowed,
                supervision_access_key=entry.supervision_access_key,
                supervision_secret_key=entry.supervision_secret_key,
                features_config=raw_features,
                latitude=entry.latitude,
                longitude=entry.longitude,
            ),
        )
        states.append(replace(
            state, is_default=identity.is_default,
            service_identity_mode=entry.service_identity_mode,
            ceph_admin_allowed=entry.ceph_admin_allowed if "ceph_admin_allowed" in entry.model_fields_set else None,
        ))
    return states
