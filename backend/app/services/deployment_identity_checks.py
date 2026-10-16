# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Iterable, Protocol
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db import LdapProvider, OidcProvider
from app.services.deployment_check_models import DeploymentCheckFinding, finding


class _OidcSecurityProvider(Protocol):
    discovery_url: str
    redirect_uri: str
    use_pkce: bool
    use_nonce: bool


class _LdapSecurityProvider(Protocol):
    url: str
    start_tls: bool
    allow_insecure: bool
    tls_verify: bool
    allow_legacy_tls: bool


def _oidc_security_issues(
    providers: Iterable[tuple[str, _OidcSecurityProvider]],
    *,
    trusted_origins: set[str],
) -> tuple[list[str], list[str]]:
    transport_issues: list[str] = []
    integrity_issues: list[str] = []
    for provider_id, provider in providers:
        discovery = urlparse(provider.discovery_url)
        redirect = urlparse(provider.redirect_uri)
        redirect_origin = f"{redirect.scheme}://{redirect.netloc}".rstrip("/")
        if discovery.scheme != "https" or not discovery.hostname or redirect.scheme != "https":
            transport_issues.append(provider_id)
        if not provider.use_pkce or not provider.use_nonce or redirect_origin not in trusted_origins:
            integrity_issues.append(provider_id)
    return transport_issues, integrity_issues


def _ldap_security_issues(
    providers: Iterable[tuple[str, _LdapSecurityProvider]],
) -> tuple[list[str], list[str]]:
    transport_issues: list[str] = []
    legacy_issues: list[str] = []
    for provider_id, provider in providers:
        scheme = urlparse(provider.url).scheme
        encrypted = scheme == "ldaps" or (scheme == "ldap" and provider.start_tls)
        if not encrypted or provider.allow_insecure or not provider.tls_verify:
            transport_issues.append(provider_id)
        if provider.allow_legacy_tls:
            legacy_issues.append(provider_id)
    return transport_issues, legacy_issues


def environment_oidc_findings(settings: Settings) -> list[DeploymentCheckFinding]:
    enabled = [
        (provider_id, provider)
        for provider_id, provider in settings.oidc_providers.items()
        if provider.enabled
    ]
    transport_issues, integrity_issues = _oidc_security_issues(
        enabled,
        trusted_origins=set(settings.effective_public_origins()),
    )
    production = settings.app_env == "production"
    return [
        finding(
            "environment-oidc-transport",
            "Environment OIDC transport",
            passed=not transport_issues,
            severity="blocker",
            pass_message="Enabled environment OIDC providers use HTTPS discovery and redirect URIs.",
            fail_message=f"OIDC provider(s) use an insecure transport: {', '.join(sorted(transport_issues))}.",
            docs_anchor="oidc-providers",
            blocks_startup=production,
        ),
        finding(
            "environment-oidc-integrity",
            "Environment OIDC integrity",
            passed=not integrity_issues,
            severity="critical",
            pass_message="Enabled environment OIDC providers require PKCE and nonce and redirect to trusted origins.",
            fail_message=(
                "OIDC provider(s) have an invalid trusted redirect or do not require PKCE and nonce: "
                f"{', '.join(sorted(integrity_issues))}."
            ),
            docs_anchor="oidc-providers",
        ),
    ]


def environment_ldap_findings(settings: Settings) -> list[DeploymentCheckFinding]:
    enabled = [
        (provider_id, provider)
        for provider_id, provider in settings.ldap_providers.items()
        if provider.enabled
    ]
    transport_issues, legacy_issues = _ldap_security_issues(enabled)
    production = settings.app_env == "production"
    return [
        finding(
            "environment-ldap-transport",
            "Environment LDAP transport",
            passed=not transport_issues,
            severity="blocker",
            pass_message="Enabled environment LDAP providers use encrypted transport with certificate verification.",
            fail_message=(
                "LDAP provider(s) allow an insecure or unverified authentication transport: "
                f"{', '.join(sorted(transport_issues))}."
            ),
            docs_anchor="ldap-providers",
            blocks_startup=production,
        ),
        finding(
            "environment-ldap-legacy-tls",
            "Environment LDAP legacy TLS",
            passed=not legacy_issues,
            severity="warning",
            pass_message="Enabled environment LDAP providers do not allow legacy TLS compatibility.",
            fail_message=f"LDAP provider(s) allow legacy TLS compatibility: {', '.join(sorted(legacy_issues))}.",
            docs_anchor="ldap-providers",
        ),
    ]


def persisted_provider_findings(settings: Settings, db: Session) -> list[DeploymentCheckFinding]:
    public_origins = set(settings.effective_public_origins())
    oidc_providers = db.query(OidcProvider).filter(OidcProvider.enabled.is_(True)).all()
    oidc_transport, oidc_integrity = _oidc_security_issues(
        ((provider.provider_id, provider) for provider in oidc_providers),
        trusted_origins=public_origins,
    )

    ldap_providers = db.query(LdapProvider).filter(LdapProvider.enabled.is_(True)).all()
    ldap_transport, ldap_legacy = _ldap_security_issues(
        (provider.provider_id, provider) for provider in ldap_providers
    )

    production = settings.app_env == "production"
    return [
        finding(
            "persisted-oidc-transport",
            "UI-managed OIDC transport",
            passed=not oidc_transport,
            severity="blocker",
            pass_message="Enabled UI-managed OIDC providers use HTTPS discovery and redirect URIs.",
            fail_message=f"UI-managed OIDC provider(s) use an insecure transport: {', '.join(sorted(oidc_transport))}.",
            docs_anchor="oidc-providers",
            blocks_startup=production,
        ),
        finding(
            "persisted-oidc-integrity",
            "UI-managed OIDC integrity",
            passed=not oidc_integrity,
            severity="critical",
            pass_message="Enabled UI-managed OIDC providers require PKCE and nonce and redirect to trusted origins.",
            fail_message=(
                "UI-managed OIDC provider(s) have an invalid trusted redirect or do not require PKCE and nonce: "
                f"{', '.join(sorted(oidc_integrity))}."
            ),
            docs_anchor="oidc-providers",
        ),
        finding(
            "persisted-ldap-transport",
            "UI-managed LDAP transport",
            passed=not ldap_transport,
            severity="blocker",
            pass_message="Enabled UI-managed LDAP providers use encrypted transport with certificate verification.",
            fail_message=(
                "UI-managed LDAP provider(s) allow an insecure or unverified authentication transport: "
                f"{', '.join(sorted(ldap_transport))}."
            ),
            docs_anchor="ldap-providers",
            blocks_startup=production,
        ),
        finding(
            "persisted-ldap-legacy-tls",
            "UI-managed LDAP legacy TLS",
            passed=not ldap_legacy,
            severity="warning",
            pass_message="Enabled UI-managed LDAP providers do not allow legacy TLS compatibility.",
            fail_message=f"UI-managed LDAP provider(s) allow legacy TLS compatibility: {', '.join(sorted(ldap_legacy))}.",
            docs_anchor="ldap-providers",
        ),
    ]
