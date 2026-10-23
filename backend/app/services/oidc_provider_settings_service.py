# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
from typing import Literal, Optional
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import OIDCProviderSettings, Settings, get_settings
from app.db import OidcProvider
from app.models.oidc import (
    OIDC_PROVIDER_CONFIG_FIELDS,
    OIDC_PROVIDER_DEFAULT_SCOPES,
    OIDCProviderAdminItem,
    OIDCProviderAdminPayload,
    OIDCProviderFieldLock,
)
from app.services.identity_provider_repository import IdentityProviderRepository
from app.services.identity_provider_resolution import (
    list_effective_identity_providers,
    resolve_identity_provider_map,
)
from app.utils.identity_provider_ids import (
    identity_provider_environment_source,
    normalize_identity_provider_id,
)


OIDC_PROVIDER_FIELDS = (
    "provider_id",
    *OIDC_PROVIDER_CONFIG_FIELDS,
    "client_secret",
)


def normalize_oidc_provider_id(provider_id: str) -> str:
    try:
        return normalize_identity_provider_id(provider_id)
    except ValueError as exc:
        raise ValueError("Invalid OIDC provider id") from exc


def _validate_production_payload(payload: OIDCProviderAdminPayload, settings: Optional[Settings] = None) -> None:
    settings = settings or get_settings()
    if settings.app_env != "production" or not payload.enabled:
        return
    discovery = urlparse(payload.discovery_url)
    redirect = urlparse(payload.redirect_uri)
    redirect_origin = f"{redirect.scheme}://{redirect.netloc}".rstrip("/")
    if discovery.scheme != "https" or not discovery.hostname:
        raise ValueError("OIDC discovery must use HTTPS in production")
    if redirect.scheme != "https" or redirect_origin not in set(settings.effective_public_origins()):
        raise ValueError("OIDC redirect must use a configured PUBLIC_ORIGIN in production")
    if not payload.use_pkce or not payload.use_nonce:
        raise ValueError("OIDC PKCE and nonce are mandatory in production")


def list_effective_oidc_providers(
    db: Session,
    settings: Optional[Settings] = None,
) -> list[OIDCProviderAdminItem]:
    settings = settings or get_settings()
    env_providers = _environment_provider_map(settings)
    return list_effective_identity_providers(
        env_providers,
        _provider_repository(db, env_providers).list(),
        environment_item=_environment_provider_item,
        persisted_item=_ui_provider_item,
    )


def resolve_oidc_provider_map(
    db: Session,
    settings: Optional[Settings] = None,
) -> dict[str, OIDCProviderSettings]:
    settings = settings or get_settings()
    env_providers = _environment_provider_map(settings)
    return resolve_identity_provider_map(
        env_providers,
        _provider_repository(db, env_providers).list(),
        persisted_to_settings=_ui_provider_to_settings,
    )


def create_oidc_provider(db: Session, payload: OIDCProviderAdminPayload) -> OIDCProviderAdminItem:
    _validate_production_payload(payload)
    provider_id = normalize_oidc_provider_id(payload.provider_id)
    provider = _provider_repository(db).create(
        provider_id,
        lambda current: _apply_payload(current, payload, replace_secret=True),
    )
    return _ui_provider_item(provider)


def update_oidc_provider(
    db: Session,
    provider_id: str,
    payload: OIDCProviderAdminPayload,
) -> OIDCProviderAdminItem:
    _validate_production_payload(payload)
    normalized_id = normalize_oidc_provider_id(provider_id)
    payload_id = normalize_oidc_provider_id(payload.provider_id)
    if payload_id != normalized_id:
        raise ValueError("provider_id cannot be changed")
    provider = _provider_repository(db).update(
        normalized_id,
        lambda current: _apply_payload(current, payload, replace_secret=False),
    )
    return _ui_provider_item(provider)


def delete_oidc_provider(db: Session, provider_id: str) -> None:
    normalized_id = normalize_oidc_provider_id(provider_id)
    _provider_repository(db).delete(normalized_id)


def _environment_provider_map(settings: Optional[Settings] = None) -> dict[str, OIDCProviderSettings]:
    settings = settings or get_settings()
    return dict(settings.oidc_providers)


def _provider_repository(
    db: Session,
    environment_providers: Optional[dict[str, OIDCProviderSettings]] = None,
) -> IdentityProviderRepository[OidcProvider]:
    providers = _environment_provider_map() if environment_providers is None else environment_providers
    return IdentityProviderRepository(db, OidcProvider, providers, "OIDC")


def _apply_payload(provider: OidcProvider, payload: OIDCProviderAdminPayload, *, replace_secret: bool) -> None:
    provider.provider_id = normalize_oidc_provider_id(payload.provider_id)
    provider.display_name = payload.display_name
    provider.discovery_url = payload.discovery_url
    provider.client_id = payload.client_id
    provider.redirect_uri = payload.redirect_uri
    provider.scopes_json = _dump_scopes(payload.scopes)
    provider.prompt = payload.prompt
    provider.enabled = bool(payload.enabled)
    provider.icon_url = payload.icon_url
    provider.use_pkce = bool(payload.use_pkce)
    provider.use_nonce = bool(payload.use_nonce)
    provider.linking_policy = payload.linking_policy
    provider.trusted_email_domains_json = _dump_string_list(payload.trusted_email_domains)
    if payload.clear_client_secret:
        provider.client_secret = None
    elif replace_secret or payload.client_secret is not None:
        provider.client_secret = payload.client_secret


def _ui_provider_to_settings(provider: OidcProvider) -> OIDCProviderSettings:
    return OIDCProviderSettings(
        display_name=provider.display_name,
        discovery_url=provider.discovery_url,
        client_id=provider.client_id,
        client_secret=provider.client_secret,
        redirect_uri=provider.redirect_uri,
        scopes=_load_scopes(provider.scopes_json),
        prompt=provider.prompt,
        enabled=bool(provider.enabled),
        icon_url=provider.icon_url,
        use_pkce=bool(provider.use_pkce),
        use_nonce=bool(provider.use_nonce),
        linking_policy=provider.linking_policy,
        trusted_email_domains=_load_string_list(provider.trusted_email_domains_json),
    )


def _ui_provider_item(provider: OidcProvider) -> OIDCProviderAdminItem:
    return _provider_item(
        provider.provider_id,
        _ui_provider_to_settings(provider),
        source="ui",
    )


def _provider_item(
    provider_id: str,
    provider: OIDCProviderSettings,
    *,
    source: Literal["environment", "ui"],
    field_locks: Optional[dict[str, OIDCProviderFieldLock]] = None,
) -> OIDCProviderAdminItem:
    return OIDCProviderAdminItem(
        provider_id=provider_id,
        display_name=provider.display_name,
        discovery_url=provider.discovery_url,
        client_id=provider.client_id,
        redirect_uri=provider.redirect_uri,
        scopes=list(provider.scopes or []),
        prompt=provider.prompt,
        enabled=bool(provider.enabled),
        icon_url=provider.icon_url,
        use_pkce=bool(provider.use_pkce),
        use_nonce=bool(provider.use_nonce),
        linking_policy=provider.linking_policy,
        trusted_email_domains=list(provider.trusted_email_domains or []),
        source=source,
        editable=source == "ui",
        field_locks=field_locks or {},
        has_client_secret=bool(provider.client_secret),
    )


def _environment_provider_item(provider_id: str, provider: OIDCProviderSettings) -> OIDCProviderAdminItem:
    return _provider_item(
        provider_id,
        provider,
        source="environment",
        field_locks={
            field: OIDCProviderFieldLock(
                forced=True,
                source=identity_provider_environment_source("OIDC_PROVIDERS", provider_id, field),
            )
            for field in OIDC_PROVIDER_FIELDS
        },
    )


def _load_scopes(raw: str) -> list[str]:
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or not parsed:
        raise ValueError("OIDC provider scopes must be a non-empty JSON list")
    if any(not isinstance(item, str) or not item.strip() for item in parsed):
        raise ValueError("OIDC provider scopes must contain non-empty strings")
    return [item.strip() for item in parsed]


def _dump_scopes(scopes: list[str]) -> str:
    normalized = [item.strip() for item in scopes if isinstance(item, str) and item.strip()]
    return json.dumps(normalized or list(OIDC_PROVIDER_DEFAULT_SCOPES), separators=(",", ":"))


def _load_string_list(raw: str) -> list[str]:
    parsed = json.loads(raw)
    if not isinstance(parsed, list) or any(not isinstance(item, str) for item in parsed):
        raise ValueError("OIDC provider domains must be a JSON list of strings")
    return [item for item in parsed if item]


def _dump_string_list(values: list[str]) -> str:
    return json.dumps(list(values or []), separators=(",", ":"))
