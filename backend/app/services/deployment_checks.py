# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Callable, Literal
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from app.core.config import DeploymentProfile, Settings, is_local_origin, is_weak_secret_value
from app.core.database import is_sqlite_url
from app.core.runtime_surfaces import RuntimeSurface, runtime_surface_enabled
from app.db import (
    BucketMigration,
    LdapProvider,
    OidcProvider,
    S3Connection,
    StorageEndpoint,
    User,
    UserRole,
    WebAuthnCredential,
)
from app.models.app_settings import AppSettings
from app.utils.network_targets import host_matches_allowlist
from app.utils.s3_connection_endpoint import parse_custom_endpoint_config


CheckResult = Literal["pass", "fail", "manual"]
CheckSeverity = Literal["blocker", "critical", "warning"]
CheckLevel = Literal["blocked", "critical", "warning", "manual", "ok"]
CheckPhase = Literal["pre-database", "full"]
ReadinessStatus = Literal["blocked", "critical", "warning", "ok"]

DOCS_BASE_URL = "https://docs.bucketreef.ksperis.com/ops/production-checks-reference/"


@dataclass(frozen=True)
class DeploymentCheckFinding:
    code: str
    label: str
    result: CheckResult
    severity: CheckSeverity | None
    message: str
    documentation_url: str
    blocks_startup: bool = False

    @property
    def level(self) -> CheckLevel:
        if self.result == "manual":
            return "manual"
        if self.result == "pass":
            return "ok"
        if self.severity == "blocker":
            return "blocked"
        if self.severity == "critical":
            return "critical"
        return "warning"


@dataclass(frozen=True, order=True)
class UncoveredTarget:
    target_type: str
    hostname: str


_PROFILE_SURFACES: dict[DeploymentProfile, dict[RuntimeSurface, bool]] = {
    "full": {},
    "admin": {
        "admin": True,
        "ceph_admin": True,
        "storage_ops": True,
        "manager": False,
        "portal": False,
        "browser": False,
    },
    "admin-no-ceph-admin": {
        "admin": True,
        "ceph_admin": False,
        "storage_ops": True,
        "manager": False,
        "portal": False,
        "browser": False,
    },
    "user": {
        "admin": False,
        "ceph_admin": False,
        "storage_ops": False,
        "manager": True,
        "portal": True,
        "browser": True,
    },
    "ceph-admin-high-security": {
        "admin": False,
        "ceph_admin": True,
        "storage_ops": False,
        "manager": False,
        "portal": False,
        "browser": False,
    },
}


def _docs(anchor: str) -> str:
    return f"{DOCS_BASE_URL}#{anchor}"


def _finding(
    code: str,
    label: str,
    *,
    passed: bool,
    severity: CheckSeverity,
    pass_message: str,
    fail_message: str,
    docs_anchor: str | None = None,
    blocks_startup: bool = False,
) -> DeploymentCheckFinding:
    return DeploymentCheckFinding(
        code=code,
        label=label,
        result="pass" if passed else "fail",
        severity=severity,
        message=pass_message if passed else fail_message,
        documentation_url=_docs(docs_anchor or code),
        blocks_startup=bool(not passed and blocks_startup),
    )


def _manual(code: str, label: str, message: str, docs_anchor: str | None = None) -> DeploymentCheckFinding:
    return DeploymentCheckFinding(
        code=code,
        label=label,
        result="manual",
        severity=None,
        message=message,
        documentation_url=_docs(docs_anchor or code),
    )


def _is_postgresql(url: str) -> bool:
    text = str(url or "").strip().lower()
    return text.startswith("postgresql") or text.startswith("postgres")


def _origin_problem(settings: Settings) -> str | None:
    public_origins = settings.effective_public_origins()
    webauthn_origins = settings.effective_webauthn_origins()
    parsed_webauthn = []
    for name, origins in (
        ("PUBLIC_ORIGIN/PUBLIC_ORIGINS", public_origins),
        ("WEBAUTHN_ORIGIN/WEBAUTHN_ORIGINS", webauthn_origins),
    ):
        for origin in origins:
            parsed = urlparse(origin)
            if (
                parsed.scheme != "https"
                or not parsed.hostname
                or parsed.path not in {"", "/"}
                or parsed.params
                or parsed.query
                or parsed.fragment
            ):
                return f"{name} must contain HTTPS origins without paths for production."
            if name.startswith("WEBAUTHN"):
                parsed_webauthn.append(parsed)
    if not set(webauthn_origins).issubset(set(public_origins)):
        return "Every WebAuthn origin must also be a trusted public origin."
    rp_id = settings.webauthn_rp_id.strip().lower().rstrip(".")
    if not rp_id or ":" in rp_id or "/" in rp_id:
        return "WEBAUTHN_RP_ID must be a DNS domain for production."
    for origin in parsed_webauthn:
        host = (origin.hostname or "").lower().rstrip(".")
        if host != rp_id and not host.endswith(f".{rp_id}"):
            return "WEBAUTHN_RP_ID must cover every configured WebAuthn origin."
    return None


def _hostname(url: str) -> str:
    return str(urlparse(url).hostname or "").strip().lower().rstrip(".")


def find_uncovered_outbound_targets(db: Session, settings: Settings) -> list[UncoveredTarget]:
    uncovered: set[UncoveredTarget] = set()
    connections = (
        db.query(S3Connection)
        .filter(
            S3Connection.is_shared.is_(False),
            S3Connection.server_managed.is_(False),
            S3Connection.storage_endpoint_id.is_(None),
            S3Connection.custom_endpoint_config.is_not(None),
        )
        .all()
    )
    for connection in connections:
        try:
            hostname = _hostname(parse_custom_endpoint_config(connection.custom_endpoint_config).endpoint_url or "")
        except (TypeError, ValueError):
            hostname = "<invalid>"
        if not host_matches_allowlist(hostname, settings.user_supplied_s3_endpoint_allowed_hosts):
            uncovered.add(UncoveredTarget("user-s3-endpoint", hostname or "<invalid>"))

    webhooks = db.query(BucketMigration.webhook_url).filter(BucketMigration.webhook_url.is_not(None)).all()
    for (webhook_url,) in webhooks:
        hostname = _hostname(webhook_url or "") or "<invalid>"
        if not host_matches_allowlist(hostname, settings.bucket_migration_webhook_allowed_hosts):
            uncovered.add(UncoveredTarget("migration-webhook", hostname))
    return sorted(uncovered)


def _environment_oidc_findings(settings: Settings) -> list[DeploymentCheckFinding]:
    enabled = [(provider_id, provider) for provider_id, provider in settings.oidc_providers.items() if provider.enabled]
    transport_issues: list[str] = []
    integrity_issues: list[str] = []
    trusted_origins = set(settings.effective_public_origins())
    for provider_id, provider in enabled:
        discovery = urlparse(provider.discovery_url)
        redirect = urlparse(provider.redirect_uri)
        redirect_origin = f"{redirect.scheme}://{redirect.netloc}".rstrip("/")
        if discovery.scheme != "https" or not discovery.hostname or redirect.scheme != "https":
            transport_issues.append(provider_id)
        if not provider.use_pkce or not provider.use_nonce or redirect_origin not in trusted_origins:
            integrity_issues.append(provider_id)
    production = settings.app_env == "production"
    return [
        _finding(
            "environment-oidc-transport",
            "Environment OIDC transport",
            passed=not transport_issues,
            severity="blocker",
            pass_message="Enabled environment OIDC providers use HTTPS discovery and redirect URIs.",
            fail_message=f"OIDC provider(s) use an insecure transport: {', '.join(sorted(transport_issues))}.",
            docs_anchor="oidc-providers",
            blocks_startup=production,
        ),
        _finding(
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


def _environment_ldap_findings(settings: Settings) -> list[DeploymentCheckFinding]:
    enabled = [(provider_id, provider) for provider_id, provider in settings.ldap_providers.items() if provider.enabled]
    transport_issues: list[str] = []
    legacy_issues: list[str] = []
    for provider_id, provider in enabled:
        scheme = urlparse(provider.url).scheme
        encrypted = scheme == "ldaps" or (scheme == "ldap" and provider.start_tls)
        if not encrypted or provider.allow_insecure or not provider.tls_verify:
            transport_issues.append(provider_id)
        if provider.allow_legacy_tls:
            legacy_issues.append(provider_id)
    production = settings.app_env == "production"
    return [
        _finding(
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
        _finding(
            "environment-ldap-legacy-tls",
            "Environment LDAP legacy TLS",
            passed=not legacy_issues,
            severity="warning",
            pass_message="Enabled environment LDAP providers do not allow legacy TLS compatibility.",
            fail_message=f"LDAP provider(s) allow legacy TLS compatibility: {', '.join(sorted(legacy_issues))}.",
            docs_anchor="ldap-providers",
        ),
    ]


def _persisted_provider_findings(settings: Settings, db: Session) -> list[DeploymentCheckFinding]:
    public_origins = set(settings.effective_public_origins())
    oidc_transport: list[str] = []
    oidc_integrity: list[str] = []
    for provider in db.query(OidcProvider).filter(OidcProvider.enabled.is_(True)).all():
        discovery = urlparse(provider.discovery_url)
        redirect = urlparse(provider.redirect_uri)
        redirect_origin = f"{redirect.scheme}://{redirect.netloc}".rstrip("/")
        if discovery.scheme != "https" or not discovery.hostname or redirect.scheme != "https":
            oidc_transport.append(provider.provider_id)
        if not provider.use_pkce or not provider.use_nonce or redirect_origin not in public_origins:
            oidc_integrity.append(provider.provider_id)

    ldap_transport: list[str] = []
    ldap_legacy: list[str] = []
    for provider in db.query(LdapProvider).filter(LdapProvider.enabled.is_(True)).all():
        scheme = urlparse(provider.url).scheme
        encrypted = scheme == "ldaps" or (scheme == "ldap" and provider.start_tls)
        if not encrypted or provider.allow_insecure or not provider.tls_verify:
            ldap_transport.append(provider.provider_id)
        if provider.allow_legacy_tls:
            ldap_legacy.append(provider.provider_id)

    production = settings.app_env == "production"
    return [
        _finding(
            "persisted-oidc-transport",
            "UI-managed OIDC transport",
            passed=not oidc_transport,
            severity="blocker",
            pass_message="Enabled UI-managed OIDC providers use HTTPS discovery and redirect URIs.",
            fail_message=f"UI-managed OIDC provider(s) use an insecure transport: {', '.join(sorted(oidc_transport))}.",
            docs_anchor="oidc-providers",
            blocks_startup=production,
        ),
        _finding(
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
        _finding(
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
        _finding(
            "persisted-ldap-legacy-tls",
            "UI-managed LDAP legacy TLS",
            passed=not ldap_legacy,
            severity="warning",
            pass_message="Enabled UI-managed LDAP providers do not allow legacy TLS compatibility.",
            fail_message=f"UI-managed LDAP provider(s) allow legacy TLS compatibility: {', '.join(sorted(ldap_legacy))}.",
            docs_anchor="ldap-providers",
        ),
    ]


def _persisted_security_findings(db: Session) -> list[DeploymentCheckFinding]:
    active_admins = (
        db.query(User.id)
        .filter(
            User.is_active.is_(True),
            User.role.in_([UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value]),
        )
        .all()
    )
    admin_ids = [row[0] for row in active_admins]
    enrolled_admin_ids: set[int] = set()
    if admin_ids:
        enrolled_admin_ids = {
            row[0]
            for row in db.query(WebAuthnCredential.user_id)
            .filter(
                WebAuthnCredential.user_id.in_(admin_ids),
                WebAuthnCredential.revoked_at.is_(None),
            )
            .distinct()
            .all()
        }
    missing_passkeys = len(admin_ids) - len(enrolled_admin_ids)

    endpoints = db.query(StorageEndpoint).all()
    unverified_tls = sum(1 for endpoint in endpoints if not endpoint.verify_tls)
    reused_privileged_identity = 0
    for endpoint in endpoints:
        privileged_access_keys = [
            value.strip()
            for value in (
                endpoint.admin_access_key,
                endpoint.supervision_access_key,
                endpoint.ceph_admin_access_key,
            )
            if value and value.strip()
        ]
        if len(privileged_access_keys) != len(set(privileged_access_keys)):
            reused_privileged_identity += 1

    return [
        _finding(
            "admin-passkey-enrollment",
            "Administrator passkey enrollment",
            passed=missing_passkeys == 0,
            severity="critical",
            pass_message="Every active administrator has at least one enrolled passkey.",
            fail_message=f"{missing_passkeys} active administrator account(s) have no enrolled passkey.",
        ),
        _finding(
            "storage-endpoint-tls",
            "Storage endpoint TLS verification",
            passed=unverified_tls == 0,
            severity="warning",
            pass_message="Stored storage endpoints verify TLS certificates.",
            fail_message=f"{unverified_tls} storage endpoint(s) have TLS certificate verification disabled.",
        ),
        _finding(
            "storage-identity-separation",
            "Privileged storage identity separation",
            passed=reused_privileged_identity == 0,
            severity="warning",
            pass_message="Configured Admin Ops, supervision, and Ceph Admin identities are distinct per endpoint.",
            fail_message=(
                f"{reused_privileged_identity} storage endpoint(s) reuse the same access key across privileged roles; "
                "use distinct identities where practical."
            ),
        ),
    ]


def run_deployment_checks(
    settings: Settings,
    *,
    app_settings: AppSettings | None,
    profile: DeploymentProfile | None = None,
    db: Session | None = None,
    include_manual: bool = True,
    phase: CheckPhase = "full",
) -> list[DeploymentCheckFinding]:
    profile = profile or settings.deployment_profile
    findings: list[DeploymentCheckFinding] = []
    production = settings.app_env == "production"

    findings.append(
        _finding(
            "app-env",
            "Production environment",
            passed=production,
            severity="critical",
            pass_message="APP_ENV is production.",
            fail_message="APP_ENV is not production; use this report as a preflight before publication.",
        )
    )

    origin_problem = _origin_problem(settings)
    findings.append(
        _finding(
            "trusted-origins",
            "Trusted browser origins",
            passed=origin_problem is None,
            severity="critical",
            pass_message="Public and WebAuthn origins use HTTPS and the RP ID covers every WebAuthn origin.",
            fail_message=origin_problem or "Trusted browser origins are invalid.",
        )
    )

    non_local_origin = any(not is_local_origin(origin) for origin in settings.effective_public_origins())
    findings.append(
        _finding(
            "authentication-cookie-secure",
            "Secure authentication cookie",
            passed=settings.refresh_token_cookie_secure or not non_local_origin,
            severity="blocker",
            pass_message="Authentication cookies use a secure transport for non-local browser origins.",
            fail_message="REFRESH_TOKEN_COOKIE_SECURE must be enabled when browser origins are non-local.",
            docs_anchor="authentication-cookies",
            blocks_startup=production,
        )
    )

    samesite = settings.refresh_token_cookie_samesite.strip().lower()
    cookie_scope_ok = settings.refresh_token_cookie_domain is None and samesite in {"lax", "strict"}
    findings.append(
        _finding(
            "authentication-cookie-scope",
            "Authentication cookie scope",
            passed=cookie_scope_ok,
            severity="critical",
            pass_message="Authentication cookies are host-only and use SameSite=Lax or SameSite=Strict.",
            fail_message="Authentication cookies should remain host-only and use SameSite=Lax or SameSite=Strict.",
            docs_anchor="authentication-cookies",
        )
    )

    allowed_hosts = {host.strip().lower() for host in settings.allowed_hosts if host.strip()}
    findings.append(
        _finding(
            "allowed-hosts",
            "Allowed HTTP hosts",
            passed=bool(allowed_hosts) and "*" not in allowed_hosts,
            severity="critical",
            pass_message="ALLOWED_HOSTS contains an explicit host boundary.",
            fail_message="Configure explicit ALLOWED_HOSTS instead of an empty or wildcard boundary.",
            docs_anchor="network-boundary",
        )
    )

    public_origin_set = set(settings.effective_public_origins())
    cors_set = {str(origin or "").strip().rstrip("/") for origin in settings.cors_origins if str(origin or "").strip()}
    findings.append(
        _finding(
            "cors-boundary",
            "CORS boundary",
            passed="*" not in cors_set and cors_set == public_origin_set,
            severity="critical",
            pass_message="CORS origins match the trusted public browser origins.",
            fail_message="CORS_ORIGINS should exactly match the trusted public origins and must not contain '*'.",
            docs_anchor="network-boundary",
        )
    )

    broad_proxy = False
    for cidr in settings.trusted_proxy_cidrs:
        network = ipaddress.ip_network(cidr, strict=False)
        if network.prefixlen == 0:
            broad_proxy = True
            break
    if broad_proxy:
        findings.append(
            _finding(
                "trusted-proxies",
                "Trusted proxy boundary",
                passed=False,
                severity="blocker",
                pass_message="Trusted proxies are narrowly scoped.",
                fail_message="TRUSTED_PROXY_CIDRS trusts an entire address space; configure only direct proxy peers.",
                docs_anchor="trusted-proxies",
                blocks_startup=production,
            )
        )
    else:
        findings.append(
            _finding(
                "trusted-proxies",
                "Trusted proxy boundary",
                passed=bool(settings.trusted_proxy_cidrs),
                severity="warning",
                pass_message="Trusted proxy CIDRs are explicitly configured.",
                fail_message=(
                    "No trusted proxy CIDR is configured. This is safe when clients connect directly, but forwarded client "
                    "addresses will be ignored behind a reverse proxy."
                ),
                docs_anchor="trusted-proxies",
            )
        )

    ui_keys = settings.effective_ui_jwt_keys()
    api_keys = settings.effective_api_jwt_keys()
    credential_keys = list(settings.credential_keys)
    strong_keys = bool(ui_keys and api_keys and credential_keys) and not any(
        is_weak_secret_value(value) for value in [*ui_keys, *api_keys, *credential_keys]
    )
    findings.append(
        _finding(
            "key-strength",
            "Secret key strength",
            passed=strong_keys,
            severity="blocker",
            pass_message="Effective UI JWT, API JWT, and credential-encryption keys are strong and non-default.",
            fail_message="Replace weak/default UI JWT, API JWT, or credential-encryption keys with high-entropy values.",
            docs_anchor="secret-key-rings",
            blocks_startup=production,
        )
    )
    key_sets = (set(ui_keys), set(api_keys), set(credential_keys))
    distinct_keys = not (key_sets[0] & key_sets[1] or key_sets[0] & key_sets[2] or key_sets[1] & key_sets[2])
    findings.append(
        _finding(
            "key-separation",
            "Secret key separation",
            passed=distinct_keys,
            severity="critical",
            pass_message="UI JWT, API JWT, and credential-encryption key rings are mutually distinct.",
            fail_message="Use distinct UI_JWT_KEYS, API_JWT_KEYS, and CREDENTIAL_KEYS for production.",
            docs_anchor="secret-key-rings",
        )
    )

    seed_endpoint_configured = "seed_s3_endpoint" in settings.model_fields_set
    seed_endpoint = urlparse(settings.seed_s3_endpoint)
    seed_issues: list[str] = []
    if seed_endpoint_configured and (seed_endpoint.scheme != "https" or not seed_endpoint.hostname):
        seed_issues.append("SEED_S3_ENDPOINT must use HTTPS")
    seed_secrets = {
        "SEED_S3_SECRET_KEY": settings.seed_s3_secret_key if seed_endpoint_configured else None,
        "SEED_RGW_ADMIN_SECRET_KEY": settings.seed_rgw_admin_secret_key,
        "SEED_SUPERVISION_SECRET_KEY": settings.seed_supervision_secret_key,
        "SEED_CEPH_ADMIN_SECRET_KEY": settings.seed_ceph_admin_secret_key,
    }
    for name, value in seed_secrets.items():
        if value is not None and is_weak_secret_value(value):
            seed_issues.append(f"{name} is weak/default")
    findings.append(
        _finding(
            "seed-security",
            "Seed configuration",
            passed=not seed_issues,
            severity="critical",
            pass_message="Configured seed endpoints and seed secrets satisfy the production guidance.",
            fail_message="; ".join(seed_issues) + "." if seed_issues else "Seed configuration requires review.",
        )
    )

    cron_weak = is_weak_secret_value(settings.internal_cron_token)
    if settings.scheduled_jobs_enabled:
        findings.append(
            _finding(
                "cron-token",
                "Scheduler token",
                passed=not cron_weak,
                severity="blocker",
                pass_message="The internal scheduler token is strong.",
                fail_message="INTERNAL_CRON_TOKEN must be a strong non-default secret while scheduled jobs are enabled.",
                docs_anchor="scheduler-token",
                blocks_startup=production,
            )
        )
    else:
        findings.append(
            _finding(
                "cron-token",
                "Scheduler token",
                passed=settings.internal_cron_token is None or not cron_weak,
                severity="warning",
                pass_message="Scheduled jobs are disabled or the configured internal token is strong.",
                fail_message="A weak INTERNAL_CRON_TOKEN is configured even though scheduled jobs are disabled; remove or rotate it.",
                docs_anchor="scheduler-token",
            )
        )

    findings.extend(_environment_oidc_findings(settings))
    findings.extend(_environment_ldap_findings(settings))

    if phase == "full":
        if app_settings is None:
            findings.append(
                _finding(
                    "app-settings",
                    "Application settings",
                    passed=False,
                    severity="critical",
                    pass_message="Application settings are available.",
                    fail_message="Application settings could not be loaded; application-level security checks are incomplete.",
                )
            )
        else:
            findings.append(
                _finding(
                    "app-settings",
                    "Application settings",
                    passed=True,
                    severity="critical",
                    pass_message="Application settings are available for readiness checks.",
                    fail_message="Application settings could not be loaded.",
                )
            )
            findings.append(
                _finding(
                    "admin-passkey-policy",
                    "Administrator passkey policy",
                    passed=app_settings.general.require_passkey_for_admins,
                    severity="critical",
                    pass_message="Administrator passkeys are required.",
                    fail_message=(
                        "Enroll an administrator passkey, then enable 'Require passkeys for administrators' before production."
                    ),
                )
            )
            access_key_login_safe = (
                not app_settings.general.allow_login_access_keys
                or settings.require_registered_s3_login_endpoints
                or not app_settings.general.allow_login_custom_endpoint
            )
            findings.append(
                _finding(
                    "registered-s3-login-endpoints",
                    "S3 login endpoint boundary",
                    passed=access_key_login_safe,
                    severity="critical",
                    pass_message="Direct S3 access-key login cannot use an unregistered custom endpoint.",
                    fail_message=(
                        "Custom S3 endpoint login is enabled without requiring registered endpoints; restrict it before production."
                    ),
                    docs_anchor="s3-login-endpoint-boundary",
                )
            )

    postgresql = _is_postgresql(settings.database_url)
    database_severity: CheckSeverity = "critical" if profile != "full" or settings.backend_replicas > 1 else "warning"
    database_ok = postgresql
    findings.append(
        _finding(
            "database",
            "Database topology",
            passed=database_ok,
            severity=database_severity,
            pass_message=(
                "PostgreSQL is configured."
                if postgresql
                else "SQLite is used by a single full-profile backend; PostgreSQL remains recommended for production."
            ),
            fail_message=(
                "SQLite is suitable only for a single full-profile backend; PostgreSQL is recommended for production."
                if database_severity == "warning"
                else "Split, high-security, or multi-replica deployments require PostgreSQL."
            ),
            docs_anchor="database-topology",
        )
    )
    findings.append(
        _finding(
            "sqlite-bucket-migration-worker",
            "SQLite migration worker",
            passed=not (is_sqlite_url(settings.database_url) and settings.bucket_migration_worker_enabled),
            severity="warning",
            pass_message="The bucket migration worker is not combined with SQLite, or PostgreSQL is configured.",
            fail_message=(
                "SQLite is configured while the bucket migration worker is enabled; PostgreSQL is recommended for long-running migrations."
            ),
            docs_anchor="database-topology",
        )
    )

    if profile in {"admin", "admin-no-ceph-admin", "user", "ceph-admin-high-security"}:
        expected_jobs = profile in {"admin", "admin-no-ceph-admin"}
        job_ok = settings.scheduled_jobs_enabled is expected_jobs
        severity = "blocker" if profile == "ceph-admin-high-security" else "critical"
        findings.append(
            _finding(
                "job-owner",
                "Scheduled job ownership",
                passed=job_ok,
                severity=severity,
                pass_message="Scheduled-job ownership matches the deployment profile.",
                fail_message=(
                    "The administration profile must own scheduled jobs."
                    if expected_jobs
                    else "This deployment profile must disable scheduled jobs."
                ),
                docs_anchor="scheduled-job-ownership",
                blocks_startup=profile == "ceph-admin-high-security",
            )
        )
    else:
        findings.append(
            _finding(
                "job-owner",
                "Scheduled job ownership",
                passed=settings.scheduled_jobs_enabled,
                severity="warning",
                pass_message="This full-profile instance owns scheduled jobs.",
                fail_message="Scheduled jobs are disabled on this full-profile instance; verify they are intentionally run elsewhere.",
                docs_anchor="scheduled-job-ownership",
            )
        )

    high_security_contract = profile == "ceph-admin-high-security" or settings.ceph_admin_high_security_mode
    split_surface_contract = profile in {"admin", "admin-no-ceph-admin", "user"}
    for surface, expected in _PROFILE_SURFACES[profile].items():
        enabled = runtime_surface_enabled(settings, surface)
        blocks_startup = high_security_contract or (production and split_surface_contract)
        findings.append(
            _finding(
                f"surface-{surface.replace('_', '-')}",
                f"Runtime surface: {surface.replace('_', ' ').title()}",
                passed=enabled is expected,
                severity="blocker" if blocks_startup else "critical",
                pass_message=f"Runtime surface {surface} matches profile {profile}.",
                fail_message=f"Runtime surface {surface} must be {'enabled' if expected else 'disabled'} for profile {profile}.",
                docs_anchor="runtime-surfaces",
                blocks_startup=blocks_startup,
            )
        )

    high_security_mode_ok = (
        (profile != "ceph-admin-high-security" and not settings.ceph_admin_high_security_mode)
        or (profile == "ceph-admin-high-security" and settings.ceph_admin_high_security_mode)
    )
    findings.append(
        _finding(
            "high-security-mode",
            "Ceph Admin high-security mode",
            passed=high_security_mode_ok,
            severity="blocker",
            pass_message="Ceph Admin high-security mode matches the selected deployment profile.",
            fail_message="CEPH_ADMIN_HIGH_SECURITY_MODE and DEPLOYMENT_PROFILE=ceph-admin-high-security must be enabled together.",
            docs_anchor="ceph-admin-high-security-boundary",
            blocks_startup=profile == "ceph-admin-high-security" or settings.ceph_admin_high_security_mode,
        )
    )

    if profile in {"admin", "admin-no-ceph-admin", "user"}:
        public_origins = settings.effective_public_origins()
        webauthn_origins = settings.effective_webauthn_origins()
        findings.append(
            _finding(
                "shared-origins",
                "Split deployment public origins",
                passed=len(public_origins) >= 2,
                severity="critical",
                pass_message="Multiple trusted public origins are configured for the split deployment.",
                fail_message="Split admin/user deployments must configure both public origins on each backend.",
                docs_anchor="split-deployment-contract",
            )
        )
        findings.append(
            _finding(
                "webauthn-origins",
                "Split deployment WebAuthn origins",
                passed=set(webauthn_origins) == set(public_origins),
                severity="critical",
                pass_message="WebAuthn accepts the same trusted origins as the split deployment.",
                fail_message="WebAuthn origins must cover every trusted public origin in a split deployment.",
                docs_anchor="split-deployment-contract",
            )
        )

    if phase == "full" and db is not None:
        findings.extend(_persisted_security_findings(db))
        findings.extend(_persisted_provider_findings(settings, db))
        uncovered = find_uncovered_outbound_targets(db, settings)
        preview = ", ".join(f"{item.target_type}:{item.hostname}" for item in uncovered[:5])
        suffix = " ..." if len(uncovered) > 5 else ""
        findings.append(
            _finding(
                "outbound-target-allowlists",
                "Persisted outbound target allowlists",
                passed=not uncovered,
                severity="critical",
                pass_message="Persisted user-controlled outbound targets are covered by the configured allowlists.",
                fail_message=(
                    f"{len(uncovered)} persisted outbound target(s) are not covered by the configured allowlists: {preview}{suffix}"
                ),
                docs_anchor="outbound-target-allowlists",
            )
        )

    if phase == "full" and include_manual:
        findings.extend(
            [
                _manual(
                    "manual-backup-restore",
                    "Backup and restore test",
                    "Confirm that database backups and credential-encryption key recovery have been tested end to end.",
                ),
                _manual(
                    "manual-secret-management",
                    "Secret management and rotation",
                    "Confirm production secrets are injected through the approved secret-management boundary and that rotation and recovery procedures are tested.",
                ),
                _manual(
                    "manual-ingress-boundary",
                    "Ingress and network exposure",
                    "Confirm TLS, ingress restrictions, proxy peers, and private/internal endpoint exposure from the deployed network.",
                ),
                _manual(
                    "manual-auth-flow",
                    "Authentication end-to-end",
                    "Run the real administrator and enabled OIDC/LDAP login flows, including a denied or revoked access case.",
                ),
                _manual(
                    "manual-jobs-runtime",
                    "Scheduled jobs execution",
                    "Confirm healthcheck, billing, quota, and usage-history jobs actually run where intended.",
                ),
                _manual(
                    "manual-observability-audit",
                    "Observability and audit retention",
                    "Confirm backend logs, control-plane audit, and provider object-access logs are collected with the intended retention.",
                ),
                _manual(
                    "manual-image-supply-chain",
                    "Image pinning and vulnerability scans",
                    "Confirm deployed images and charts are pinned to approved versions or digests and satisfy the current vulnerability, SBOM, and image-scanning policy.",
                ),
                _manual(
                    "manual-storage-endpoint",
                    "Storage endpoint acceptance",
                    "Validate the first supported storage endpoint with healthchecks and representative allowed and denied operations.",
                ),
            ]
        )
        if profile in {"admin", "admin-no-ceph-admin", "user"}:
            findings.append(
                _manual(
                    "manual-split-state",
                    "Split deployment shared state",
                    "Compare the admin and user runtimes to confirm the intended database, key rings, origins, and single scheduler owner.",
                    docs_anchor="split-deployment-contract",
                )
            )

    return findings


def readiness_status(findings: list[DeploymentCheckFinding]) -> ReadinessStatus:
    levels = {finding.level for finding in findings}
    if "blocked" in levels:
        return "blocked"
    if "critical" in levels:
        return "critical"
    if "warning" in levels:
        return "warning"
    return "ok"


def readiness_counts(findings: list[DeploymentCheckFinding]) -> dict[CheckLevel, int]:
    counts: dict[CheckLevel, int] = {"blocked": 0, "critical": 0, "warning": 0, "manual": 0, "ok": 0}
    for finding in findings:
        counts[finding.level] += 1
    return counts


def deployment_exit_code(findings: list[DeploymentCheckFinding]) -> int:
    return 1 if any(finding.level in {"blocked", "critical"} for finding in findings) else 0


def startup_blocking_findings(findings: list[DeploymentCheckFinding]) -> list[DeploymentCheckFinding]:
    return [finding for finding in findings if finding.result == "fail" and finding.blocks_startup]


def run_outbound_target_preflight(
    db: Session,
    settings: Settings,
    *,
    emit: Callable[[str], None] = print,
) -> int:
    targets = find_uncovered_outbound_targets(db, settings)
    for target in targets:
        emit(f"{target.target_type}: {target.hostname}")
    if targets:
        emit(f"Blocked outbound hostnames: {len(targets)}")
        return 1
    emit("All persisted outbound hostnames are covered by the configured allowlists.")
    return 0
