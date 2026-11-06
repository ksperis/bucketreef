# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import OIDCProviderSettings, Settings, get_settings
from app.db import OidcProvider
from app.models.identity_provider import IdentityProviderFieldLock
from app.models.oidc import (
    OIDC_PROVIDER_CONFIG_FIELDS,
    OIDCProviderAdminItem,
    OIDCProviderAdminPayload,
)
from app.services.identity_provider_repository import IdentityProviderRepository
from app.services.identity_provider_settings_service import IdentityProviderSettingsService
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
    return _provider_service(db, settings).list_effective()


def resolve_oidc_provider_map(
    db: Session,
    settings: Optional[Settings] = None,
) -> dict[str, OIDCProviderSettings]:
    return _provider_service(db, settings).resolve_map()


def create_oidc_provider(db: Session, payload: OIDCProviderAdminPayload) -> OIDCProviderAdminItem:
    _validate_production_payload(payload)
    return _provider_service(db).create(
        payload.provider_id,
        apply=lambda current: _apply_payload(current, payload, replace_secret=True),
    )


def update_oidc_provider(
    db: Session,
    provider_id: str,
    payload: OIDCProviderAdminPayload,
) -> OIDCProviderAdminItem:
    _validate_production_payload(payload)
    return _provider_service(db).update(
        provider_id,
        payload.provider_id,
        apply=lambda current: _apply_payload(current, payload, replace_secret=False),
    )


def delete_oidc_provider(db: Session, provider_id: str) -> None:
    _provider_service(db).delete(provider_id)


def _environment_provider_map(settings: Optional[Settings] = None) -> dict[str, OIDCProviderSettings]:
    settings = settings or get_settings()
    return dict(settings.oidc_providers)


def _provider_service(
    db: Session,
    settings: Optional[Settings] = None,
) -> IdentityProviderSettingsService[OidcProvider, OIDCProviderSettings, OIDCProviderAdminItem]:
    environment_providers = _environment_provider_map(settings)
    return IdentityProviderSettingsService(
        IdentityProviderRepository(db, OidcProvider, environment_providers, "OIDC"),
        environment_providers,
        normalize_provider_id=normalize_oidc_provider_id,
        environment_item=_environment_provider_item,
        persisted_item=_ui_provider_item,
        persisted_to_settings=_ui_provider_to_settings,
    )


def _apply_payload(provider: OidcProvider, payload: OIDCProviderAdminPayload, *, replace_secret: bool) -> None:
    provider.provider_id = normalize_oidc_provider_id(payload.provider_id)
    provider.display_name = payload.display_name
    provider.discovery_url = payload.discovery_url
    provider.client_id = payload.client_id
    provider.redirect_uri = payload.redirect_uri
    provider.scopes = list(payload.scopes)
    provider.prompt = payload.prompt
    provider.enabled = payload.enabled
    provider.icon_url = payload.icon_url
    provider.use_pkce = payload.use_pkce
    provider.use_nonce = payload.use_nonce
    provider.linking_policy = payload.linking_policy
    provider.trusted_email_domains = list(payload.trusted_email_domains)
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
        scopes=list(provider.scopes),
        prompt=provider.prompt,
        enabled=provider.enabled,
        icon_url=provider.icon_url,
        use_pkce=provider.use_pkce,
        use_nonce=provider.use_nonce,
        linking_policy=provider.linking_policy,
        trusted_email_domains=list(provider.trusted_email_domains),
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
    field_locks: Optional[dict[str, IdentityProviderFieldLock]] = None,
) -> OIDCProviderAdminItem:
    return OIDCProviderAdminItem(
        provider_id=provider_id,
        display_name=provider.display_name,
        discovery_url=provider.discovery_url,
        client_id=provider.client_id,
        redirect_uri=provider.redirect_uri,
        scopes=list(provider.scopes),
        prompt=provider.prompt,
        enabled=provider.enabled,
        icon_url=provider.icon_url,
        use_pkce=provider.use_pkce,
        use_nonce=provider.use_nonce,
        linking_policy=provider.linking_policy,
        trusted_email_domains=list(provider.trusted_email_domains),
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
            field: IdentityProviderFieldLock(
                forced=True,
                source=identity_provider_environment_source("OIDC_PROVIDERS", provider_id, field),
            )
            for field in OIDC_PROVIDER_FIELDS
        },
    )
