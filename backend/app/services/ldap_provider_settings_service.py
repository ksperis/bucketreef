# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal, Optional
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import LDAPProviderSettings, Settings, get_settings
from app.db import LdapProvider
from app.models.ldap import (
    LDAP_PROVIDER_CONFIG_FIELDS,
    LDAPProviderAdminItem,
    LDAPProviderAdminPayload,
    LDAPProviderFieldLock,
)
from app.services.identity_provider_repository import IdentityProviderRepository
from app.services.identity_provider_settings_service import IdentityProviderSettingsService
from app.utils.identity_provider_ids import (
    identity_provider_environment_source,
    normalize_identity_provider_id,
)


LDAP_PROVIDER_FIELDS = (
    "provider_id",
    *LDAP_PROVIDER_CONFIG_FIELDS,
    "bind_password",
)


def normalize_ldap_provider_id(provider_id: str) -> str:
    try:
        return normalize_identity_provider_id(provider_id)
    except ValueError as exc:
        raise ValueError("Invalid LDAP provider id") from exc


def _validate_production_payload(payload: LDAPProviderAdminPayload, settings: Optional[Settings] = None) -> None:
    settings = settings or get_settings()
    if settings.app_env != "production" or not payload.enabled:
        return
    scheme = urlparse(payload.url).scheme
    encrypted_transport = scheme == "ldaps" or (scheme == "ldap" and payload.start_tls)
    if not encrypted_transport or payload.allow_insecure or not payload.tls_verify or payload.allow_legacy_tls:
        raise ValueError("LDAP provider violates the production TLS policy")


def list_effective_ldap_providers(
    db: Session,
    settings: Optional[Settings] = None,
) -> list[LDAPProviderAdminItem]:
    return _provider_service(db, settings).list_effective()


def resolve_ldap_provider_map(
    db: Session,
    settings: Optional[Settings] = None,
) -> dict[str, LDAPProviderSettings]:
    return _provider_service(db, settings).resolve_map()


def create_ldap_provider(db: Session, payload: LDAPProviderAdminPayload) -> LDAPProviderAdminItem:
    _validate_production_payload(payload)
    return _provider_service(db).create(
        payload.provider_id,
        apply=lambda current: _apply_payload(current, payload, replace_secret=True),
    )


def update_ldap_provider(
    db: Session,
    provider_id: str,
    payload: LDAPProviderAdminPayload,
) -> LDAPProviderAdminItem:
    _validate_production_payload(payload)
    return _provider_service(db).update(
        provider_id,
        payload.provider_id,
        apply=lambda current: _apply_payload(current, payload, replace_secret=False),
    )


def delete_ldap_provider(db: Session, provider_id: str) -> None:
    _provider_service(db).delete(provider_id)


def _environment_provider_map(settings: Optional[Settings] = None) -> dict[str, LDAPProviderSettings]:
    settings = settings or get_settings()
    return dict(settings.ldap_providers)


def _provider_service(
    db: Session,
    settings: Optional[Settings] = None,
) -> IdentityProviderSettingsService[LdapProvider, LDAPProviderSettings, LDAPProviderAdminItem]:
    environment_providers = _environment_provider_map(settings)
    return IdentityProviderSettingsService(
        IdentityProviderRepository(db, LdapProvider, environment_providers, "LDAP"),
        environment_providers,
        normalize_provider_id=normalize_ldap_provider_id,
        environment_item=_environment_provider_item,
        persisted_item=_ui_provider_item,
        persisted_to_settings=_ui_provider_to_settings,
    )


def _apply_payload(provider: LdapProvider, payload: LDAPProviderAdminPayload, *, replace_secret: bool) -> None:
    if payload.bind_dn is None:
        candidate_secret = None
    elif payload.clear_bind_password:
        candidate_secret = None
    elif payload.bind_password is not None:
        candidate_secret = payload.bind_password
    else:
        candidate_secret = provider.bind_password
    LDAPProviderSettings(
        display_name=payload.display_name,
        url=payload.url,
        bind_dn=payload.bind_dn,
        bind_password=candidate_secret,
        user_base_dn=payload.user_base_dn,
        user_filter=payload.user_filter,
        import_search_filter=payload.import_search_filter,
        email_attribute=payload.email_attribute,
        name_attribute=payload.name_attribute,
        subject_attribute=payload.subject_attribute,
        start_tls=payload.start_tls,
        tls_verify=payload.tls_verify,
        tls_ca_file=payload.tls_ca_file,
        allow_legacy_tls=payload.allow_legacy_tls,
        timeout_seconds=payload.timeout_seconds,
        enabled=payload.enabled,
        allow_insecure=payload.allow_insecure,
        linking_policy=payload.linking_policy,
    )

    provider.provider_id = normalize_ldap_provider_id(payload.provider_id)
    provider.display_name = payload.display_name
    provider.url = payload.url
    provider.bind_dn = payload.bind_dn
    provider.user_base_dn = payload.user_base_dn
    provider.user_filter = payload.user_filter
    provider.import_search_filter = payload.import_search_filter
    provider.email_attribute = payload.email_attribute
    provider.name_attribute = payload.name_attribute
    provider.subject_attribute = payload.subject_attribute
    provider.start_tls = payload.start_tls
    provider.tls_verify = payload.tls_verify
    provider.tls_ca_file = payload.tls_ca_file
    provider.allow_legacy_tls = payload.allow_legacy_tls
    provider.timeout_seconds = payload.timeout_seconds
    provider.enabled = payload.enabled
    provider.allow_insecure = payload.allow_insecure
    provider.linking_policy = payload.linking_policy
    if replace_secret or payload.bind_password is not None or payload.bind_dn is None or payload.clear_bind_password:
        provider.bind_password = candidate_secret


def _ui_provider_to_settings(provider: LdapProvider) -> LDAPProviderSettings:
    return LDAPProviderSettings(
        display_name=provider.display_name,
        url=provider.url,
        bind_dn=provider.bind_dn,
        bind_password=provider.bind_password,
        user_base_dn=provider.user_base_dn,
        user_filter=provider.user_filter,
        import_search_filter=provider.import_search_filter,
        email_attribute=provider.email_attribute,
        name_attribute=provider.name_attribute,
        subject_attribute=provider.subject_attribute,
        start_tls=provider.start_tls,
        tls_verify=provider.tls_verify,
        tls_ca_file=provider.tls_ca_file,
        allow_legacy_tls=provider.allow_legacy_tls,
        timeout_seconds=provider.timeout_seconds,
        enabled=provider.enabled,
        allow_insecure=provider.allow_insecure,
        linking_policy=provider.linking_policy,
    )


def _ui_provider_item(provider: LdapProvider) -> LDAPProviderAdminItem:
    return _provider_item(
        provider.provider_id,
        _ui_provider_to_settings(provider),
        source="ui",
    )


def _provider_item(
    provider_id: str,
    provider: LDAPProviderSettings,
    *,
    source: Literal["environment", "ui"],
    field_locks: Optional[dict[str, LDAPProviderFieldLock]] = None,
) -> LDAPProviderAdminItem:
    return LDAPProviderAdminItem(
        provider_id=provider_id,
        display_name=provider.display_name,
        url=provider.url,
        bind_dn=provider.bind_dn,
        user_base_dn=provider.user_base_dn,
        user_filter=provider.user_filter,
        import_search_filter=provider.import_search_filter,
        email_attribute=provider.email_attribute,
        name_attribute=provider.name_attribute,
        subject_attribute=provider.subject_attribute,
        start_tls=provider.start_tls,
        tls_verify=provider.tls_verify,
        tls_ca_file=provider.tls_ca_file,
        allow_legacy_tls=provider.allow_legacy_tls,
        timeout_seconds=provider.timeout_seconds,
        enabled=provider.enabled,
        allow_insecure=provider.allow_insecure,
        linking_policy=provider.linking_policy,
        source=source,
        editable=source == "ui",
        field_locks=field_locks or {},
        has_bind_password=bool(provider.bind_password),
    )


def _environment_provider_item(provider_id: str, provider: LDAPProviderSettings) -> LDAPProviderAdminItem:
    return _provider_item(
        provider_id,
        provider,
        source="environment",
        field_locks={
            field: LDAPProviderFieldLock(
                forced=True,
                source=identity_provider_environment_source("LDAP_PROVIDERS", provider_id, field),
            )
            for field in LDAP_PROVIDER_FIELDS
        },
    )
