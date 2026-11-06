# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
import json
from dataclasses import dataclass, replace
from typing import Literal, Optional

from pydantic import SecretStr, ValidationError, field_validator, model_validator

from app.db import StorageEndpoint
from app.core.domain_enums import StorageProvider
from app.models.storage_endpoint import (
    StorageEndpointCoordinates,
    StorageEndpointCreate,
    StorageEndpointFeatures,
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
    normalize_features,
    parse_features_mapping,
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
_CREDENTIAL_KINDS = ("admin", "runtime", "supervision", "ceph_admin")
class EnvStorageEndpoint(StorageEndpointCoordinates):
    name: str
    endpoint_url: str
    region: Optional[str] = None
    realm_id: Optional[str] = None
    zonegroup_id: Optional[str] = None
    zone_id: Optional[str] = None
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
    features: Optional[dict[str, dict[str, object]]] = None
    is_default: bool = False

    @model_validator(mode="after")
    def require_explicit_ceph_mode(self):
        if self.provider == StorageProvider.CEPH and "service_identity_mode" not in self.model_fields_set:
            raise ValueError("Ceph ENV endpoints must explicitly declare service_identity_mode.")
        return self

    normalize_string_fields = field_validator(
        "name", "endpoint_url", "region", "realm_id", "zonegroup_id", "zone_id", mode="before"
    )(
        normalize_optional_string_field
    )

@dataclass(frozen=True)
class NormalizedEndpointState:
    name: str
    endpoint_url: str
    region: Optional[str]
    realm_id: Optional[str]
    zonegroup_id: Optional[str]
    zone_id: Optional[str]
    force_path_style: bool
    verify_tls: bool
    latitude: Optional[float]
    longitude: Optional[float]
    provider: StorageProvider
    admin_access_key: Optional[str]
    admin_secret_key: Optional[str]
    service_identity_mode: Literal["managed", "external"]
    runtime_access_key: Optional[str]
    runtime_secret_key: Optional[str]
    ceph_admin_access_key: Optional[str]
    ceph_admin_secret_key: Optional[str]
    ceph_admin_allowed: bool
    supervision_access_key: Optional[str]
    supervision_secret_key: Optional[str]
    features: dict[str, dict[str, object]]
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


def _normalized_credential_pair(
    payload: StorageEndpointCreate,
    kind: str,
) -> tuple[str | None, str | None]:
    return (
        normalize_optional_string(getattr(payload, f"{kind}_access_key")),
        normalize_optional_string(
            _secret_value(getattr(payload, f"{kind}_secret_key"))
        ),
    )


def _normalized_credential_pairs(
    payload: StorageEndpointCreate,
) -> dict[str, tuple[str | None, str | None]]:
    return {
        kind: _normalized_credential_pair(payload, kind)
        for kind in _CREDENTIAL_KINDS
    }


def _validate_complete_credential_pairs(
    pairs: dict[str, tuple[str | None, str | None]],
) -> None:
    for kind, (access, secret) in pairs.items():
        if bool(access) != bool(secret):
            raise ValueError(
                f"External {kind} credentials require a complete pair."
            )


def _flatten_credential_pairs(
    pairs: dict[str, tuple[str | None, str | None]],
) -> dict[str, str | None]:
    return {
        field: value
        for kind, pair in pairs.items()
        for field, value in zip(
            (f"{kind}_access_key", f"{kind}_secret_key"),
            pair,
        )
    }


def _empty_credential_values() -> dict[str, str | None]:
    return {
        field: None
        for field_pair in _CREDENTIAL_FIELD_PAIRS
        for field in field_pair
    }


def _normalize_ceph_service_credentials(
    payload: StorageEndpointCreate,
    *,
    provider: StorageProvider,
    required_identities: set[str],
    admin_required: bool,
) -> dict[str, str | None]:
    pairs = _normalized_credential_pairs(payload)
    admin_access, admin_secret = pairs["admin"]
    supervision_access, supervision_secret = pairs["supervision"]

    (
        admin_access,
        admin_secret,
        supervision_access,
        supervision_secret,
    ) = _validate_credentials(
        provider,
        admin_access,
        admin_secret,
        supervision_access,
        supervision_secret,
        admin_required,
        payload.service_identity_mode == "external"
        and "supervision" in required_identities,
    )
    pairs["admin"] = (admin_access, admin_secret)
    pairs["supervision"] = (supervision_access, supervision_secret)

    if provider != StorageProvider.CEPH:
        return _empty_credential_values()

    runtime_access, runtime_secret = pairs["runtime"]
    if (
        payload.service_identity_mode == "external"
        and "runtime" in required_identities
        and (not runtime_access or not runtime_secret)
    ):
        raise ValueError(
            "External service identities require Runtime access key and secret key."
        )

    _validate_complete_credential_pairs(pairs)
    ceph_admin_access, ceph_admin_secret = pairs["ceph_admin"]
    if payload.ceph_admin_allowed and (
        not ceph_admin_access or not ceph_admin_secret
    ):
        raise ValueError("Allowing Ceph Admin requires its access key and secret key.")

    return _flatten_credential_pairs(pairs)


def _normalize_multisite_ids(
    payload: StorageEndpointCreate,
    provider: StorageProvider,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    if provider != StorageProvider.CEPH:
        return None, None, None

    realm_id = normalize_optional_string(payload.realm_id)
    zonegroup_id = normalize_optional_string(payload.zonegroup_id)
    zone_id = normalize_optional_string(payload.zone_id)
    multisite_ids = (realm_id, zonegroup_id, zone_id)
    if any(multisite_ids) and not all(multisite_ids):
        raise ValueError("Realm ID, zonegroup ID, and zone ID must be configured together.")
    return multisite_ids


def _normalize_endpoint_feature_policy(
    payload: StorageEndpointCreate,
    provider: StorageProvider,
    region: Optional[str],
) -> tuple[dict[str, dict[str, object]], set[str], bool]:
    feature_overrides = (
        payload.features.model_dump(exclude_unset=True)
        if payload.features is not None
        else None
    )
    features = normalize_features(
        provider,
        feature_overrides,
        region,
    )
    supervision_access, supervision_secret = _normalized_credential_pair(
        payload,
        "supervision",
    )
    if (
        provider == StorageProvider.CEPH
        and payload.service_identity_mode == "external"
        and supervision_access
        and supervision_secret
    ):
        features["healthcheck"]["enabled"] = True
        features["healthcheck"]["mode"] = "s3"
    required_identities = required_service_identity_kinds(features)
    admin_enabled = bool(features["admin"]["enabled"]) or bool(
        features["account"]["enabled"]
    )
    admin_required = admin_enabled or (
        payload.service_identity_mode == "managed" and bool(required_identities)
    )
    return features, required_identities, admin_required


def normalize_storage_endpoint_state(
    payload: StorageEndpointCreate,
) -> NormalizedEndpointState:
    name = _normalize_name(payload.name)
    endpoint_url = normalize_s3_endpoint(payload.endpoint_url)
    if not endpoint_url:
        raise ValueError("Endpoint URL is required.")
    provider = normalize_storage_provider(payload.provider)
    region = _normalize_region(provider, payload.region)
    realm_id, zonegroup_id, zone_id = _normalize_multisite_ids(payload, provider)
    features, required_identities, admin_required = _normalize_endpoint_feature_policy(
        payload,
        provider,
        region,
    )
    credentials = _normalize_ceph_service_credentials(
        payload,
        provider=provider,
        required_identities=required_identities,
        admin_required=admin_required,
    )
    return NormalizedEndpointState(
        name=name,
        endpoint_url=endpoint_url,
        region=region,
        realm_id=realm_id,
        zonegroup_id=zonegroup_id,
        zone_id=zone_id,
        force_path_style=payload.force_path_style,
        verify_tls=payload.verify_tls,
        latitude=payload.latitude,
        longitude=payload.longitude,
        provider=provider,
        admin_access_key=credentials["admin_access_key"],
        admin_secret_key=credentials["admin_secret_key"],
        service_identity_mode=payload.service_identity_mode,
        runtime_access_key=credentials["runtime_access_key"],
        runtime_secret_key=credentials["runtime_secret_key"],
        ceph_admin_access_key=credentials["ceph_admin_access_key"],
        ceph_admin_secret_key=credentials["ceph_admin_secret_key"],
        ceph_admin_allowed=payload.ceph_admin_allowed if provider == StorageProvider.CEPH else False,
        supervision_access_key=credentials["supervision_access_key"],
        supervision_secret_key=credentials["supervision_secret_key"],
        features=features,
    )


def normalize_storage_endpoint_update(
    endpoint: StorageEndpoint,
    payload: StorageEndpointUpdate,
) -> NormalizedEndpointState:
    runtime = endpoint.service_identity("runtime")
    supervision = endpoint.service_identity("supervision")
    ceph_admin = endpoint.service_identity("ceph_admin")
    if endpoint.provider == StorageProvider.CEPH.value:
        assert runtime is not None, "Ceph endpoints require a Runtime service identity."
    current_identity_mode = runtime.mode if runtime is not None else "managed"
    fields_set = set(payload.model_fields_set)
    merged = _storage_endpoint_update_base(
        endpoint,
        current_identity_mode=current_identity_mode,
        runtime=runtime,
        supervision=supervision,
        ceph_admin=ceph_admin,
    )
    switching_to_external = (
        current_identity_mode == "managed"
        and payload.service_identity_mode == "external"
    )
    if switching_to_external:
        _clear_managed_identity_credentials(merged)
    _merge_storage_endpoint_update_fields(merged, payload, fields_set)
    if switching_to_external:
        _validate_external_identity_replacements(
            merged,
            payload,
            runtime=runtime,
            supervision=supervision,
        )

    if not merged["endpoint_url"]:
        raise ValueError("Endpoint URL is required.")
    _validate_storage_endpoint_update_credential_pairs(payload, fields_set)
    _clear_secrets_for_removed_access_keys(merged, fields_set)

    return normalize_storage_endpoint_state(StorageEndpointCreate.model_validate(merged))


def _storage_endpoint_update_base(
    endpoint: StorageEndpoint,
    *,
    current_identity_mode: str,
    runtime,
    supervision,
    ceph_admin,
) -> dict:
    return StorageEndpointCreate(
        name=endpoint.name,
        endpoint_url=endpoint.endpoint_url,
        region=endpoint.region,
        realm_id=endpoint.realm_id,
        zonegroup_id=endpoint.zonegroup_id,
        zone_id=endpoint.zone_id,
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
        features=normalize_features(
            endpoint.provider,
            endpoint.features,
            endpoint.region,
        ),
        latitude=endpoint.latitude,
        longitude=endpoint.longitude,
    ).model_dump()


def _clear_managed_identity_credentials(merged: dict) -> None:
    for kind in ("runtime", "supervision"):
        merged[f"{kind}_access_key"] = None
        merged[f"{kind}_secret_key"] = None


def _merge_storage_endpoint_update_fields(
    merged: dict,
    payload: StorageEndpointUpdate,
    fields_set: set[str],
) -> None:
    preserved_fields: set[str] = set()
    for kind in ("runtime", "supervision", "ceph_admin"):
        access_field = f"{kind}_access_key"
        secret_field = f"{kind}_secret_key"
        pair_fields = {access_field, secret_field}
        if not pair_fields <= fields_set:
            continue
        raw_access = getattr(payload, access_field)
        raw_secret = getattr(payload, secret_field)
        access = normalize_optional_string(raw_access)
        secret = normalize_optional_string(_secret_value(raw_secret))
        if (
            raw_access is not None
            and raw_secret is not None
            and not access
            and not secret
        ):
            preserved_fields.update(pair_fields)

    for field in fields_set:
        if field in preserved_fields:
            continue
        merged[field] = getattr(payload, field)


def _validate_external_identity_replacements(
    merged: dict,
    payload: StorageEndpointUpdate,
    *,
    runtime,
    supervision,
) -> None:
    required = required_service_identity_kinds(
        normalize_features(
            merged["provider"],
            (
                merged["features"].model_dump(exclude_unset=True)
                if isinstance(merged["features"], StorageEndpointFeatures)
                else merged["features"]
            ),
            merged["region"],
        )
    )
    for kind, identity in (("runtime", runtime), ("supervision", supervision)):
        existing_managed = (
            identity is not None
            and identity.mode == "managed"
            and any(
                (
                    identity.rgw_uid,
                    identity.access_key,
                    identity.secret_key,
                    identity.provenance,
                )
            )
        )
        if (kind in required or existing_managed) and (
            not normalize_optional_string(getattr(payload, f"{kind}_access_key"))
            or not normalize_optional_string(
                _secret_value(getattr(payload, f"{kind}_secret_key"))
            )
        ):
            raise ValueError(
                f"Switching to external mode requires replacement {kind.title()} credentials."
            )


def _validate_storage_endpoint_update_credential_pairs(
    payload: StorageEndpointUpdate,
    fields_set: set[str],
) -> None:
    for kind in ("runtime", "supervision", "ceph_admin"):
        access_field, secret_field = f"{kind}_access_key", f"{kind}_secret_key"
        if {access_field, secret_field} & fields_set:
            has_access = bool(normalize_optional_string(getattr(payload, access_field)))
            has_secret = bool(
                normalize_optional_string(
                    _secret_value(getattr(payload, secret_field))
                )
            )
            if has_access != has_secret:
                raise ValueError(
                    f"Replacing {kind} credentials requires a complete pair."
                )


def _clear_secrets_for_removed_access_keys(
    merged: dict,
    fields_set: set[str],
) -> None:
    for access_key_field, secret_key_field in _CREDENTIAL_FIELD_PAIRS:
        if (
            access_key_field in fields_set
            and not normalize_optional_string(merged[access_key_field])
        ):
            merged[secret_key_field] = None


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
                is_default=entry.is_default,
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
        features = (
            parse_features_mapping(entry.features)
            if entry.features is not None
            else None
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
                features=features,
                latitude=entry.latitude,
                longitude=entry.longitude,
            ),
        )
        states.append(replace(state, is_default=identity.is_default))
    return states
