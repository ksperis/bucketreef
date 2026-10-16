# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from app.core.config import Settings, is_local_origin, is_weak_secret_value
from app.services.deployment_check_models import DeploymentCheckFinding, finding
from app.services.deployment_identity_checks import environment_ldap_findings, environment_oidc_findings


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


def _browser_boundary_findings(
    settings: Settings,
    *,
    production: bool,
) -> list[DeploymentCheckFinding]:
    return [
        *_browser_origin_findings(settings, production=production),
        _trusted_proxy_finding(settings, production=production),
    ]


def _browser_origin_findings(
    settings: Settings,
    *,
    production: bool,
) -> list[DeploymentCheckFinding]:
    origin_problem = _origin_problem(settings)
    non_local_origin = any(
        not is_local_origin(origin) for origin in settings.effective_public_origins()
    )
    samesite = settings.refresh_token_cookie_samesite.strip().lower()
    cookie_scope_ok = (
        settings.refresh_token_cookie_domain is None and samesite in {"lax", "strict"}
    )
    allowed_hosts = {
        host.strip().lower() for host in settings.allowed_hosts if host.strip()
    }
    public_origin_set = set(settings.effective_public_origins())
    cors_set = {
        str(origin or "").strip().rstrip("/")
        for origin in settings.cors_origins
        if str(origin or "").strip()
    }

    return [
        finding(
            "trusted-origins",
            "Trusted browser origins",
            passed=origin_problem is None,
            severity="critical",
            pass_message="Public and WebAuthn origins use HTTPS and the RP ID covers every WebAuthn origin.",
            fail_message=origin_problem or "Trusted browser origins are invalid.",
        ),
        finding(
            "authentication-cookie-secure",
            "Secure authentication cookie",
            passed=settings.refresh_token_cookie_secure or not non_local_origin,
            severity="blocker",
            pass_message="Authentication cookies use a secure transport for non-local browser origins.",
            fail_message="REFRESH_TOKEN_COOKIE_SECURE must be enabled when browser origins are non-local.",
            docs_anchor="authentication-cookies",
            blocks_startup=production,
        ),
        finding(
            "authentication-cookie-scope",
            "Authentication cookie scope",
            passed=cookie_scope_ok,
            severity="critical",
            pass_message="Authentication cookies are host-only and use SameSite=Lax or SameSite=Strict.",
            fail_message="Authentication cookies should remain host-only and use SameSite=Lax or SameSite=Strict.",
            docs_anchor="authentication-cookies",
        ),
        finding(
            "allowed-hosts",
            "Allowed HTTP hosts",
            passed=bool(allowed_hosts) and "*" not in allowed_hosts,
            severity="critical",
            pass_message="ALLOWED_HOSTS contains an explicit host boundary.",
            fail_message="Configure explicit ALLOWED_HOSTS instead of an empty or wildcard boundary.",
            docs_anchor="network-boundary",
        ),
        finding(
            "cors-boundary",
            "CORS boundary",
            passed="*" not in cors_set and cors_set == public_origin_set,
            severity="critical",
            pass_message="CORS origins match the trusted public browser origins.",
            fail_message="CORS_ORIGINS should exactly match the trusted public origins and must not contain '*'.",
            docs_anchor="network-boundary",
        ),
    ]


def _trusted_proxy_finding(
    settings: Settings,
    *,
    production: bool,
) -> DeploymentCheckFinding:
    broad_proxy = any(
        ipaddress.ip_network(cidr, strict=False).prefixlen == 0
        for cidr in settings.trusted_proxy_cidrs
    )
    if broad_proxy:
        return finding(
            "trusted-proxies",
            "Trusted proxy boundary",
            passed=False,
            severity="blocker",
            pass_message="Trusted proxies are narrowly scoped.",
            fail_message="TRUSTED_PROXY_CIDRS trusts an entire address space; configure only direct proxy peers.",
            docs_anchor="trusted-proxies",
            blocks_startup=production,
        )
    return finding(
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


def _secret_findings(
    settings: Settings,
    *,
    production: bool,
) -> list[DeploymentCheckFinding]:
    strong_keys, distinct_keys = _key_ring_state(settings)
    seed_issues = _seed_security_issues(settings)
    return [
        finding(
            "key-strength",
            "Secret key strength",
            passed=strong_keys,
            severity="blocker",
            pass_message="Effective UI JWT, API JWT, and credential-encryption keys are strong and non-default.",
            fail_message="Replace weak/default UI JWT, API JWT, or credential-encryption keys with high-entropy values.",
            docs_anchor="secret-key-rings",
            blocks_startup=production,
        ),
        finding(
            "key-separation",
            "Secret key separation",
            passed=distinct_keys,
            severity="critical",
            pass_message="UI JWT, API JWT, and credential-encryption key rings are mutually distinct.",
            fail_message="Use distinct UI_JWT_KEYS, API_JWT_KEYS, and CREDENTIAL_KEYS for production.",
            docs_anchor="secret-key-rings",
        ),
        finding(
            "seed-security",
            "Seed configuration",
            passed=not seed_issues,
            severity="critical",
            pass_message="Configured seed endpoints and seed secrets satisfy the production guidance.",
            fail_message=(
                "; ".join(seed_issues) + "."
                if seed_issues
                else "Seed configuration requires review."
            ),
        ),
        _scheduler_token_finding(settings, production=production),
    ]


def _key_ring_state(settings: Settings) -> tuple[bool, bool]:
    ui_keys = settings.effective_ui_jwt_keys()
    api_keys = settings.effective_api_jwt_keys()
    credential_keys = list(settings.credential_keys)
    strong_keys = bool(ui_keys and api_keys and credential_keys) and not any(
        is_weak_secret_value(value)
        for value in [*ui_keys, *api_keys, *credential_keys]
    )
    key_sets = (set(ui_keys), set(api_keys), set(credential_keys))
    distinct_keys = not (
        key_sets[0] & key_sets[1]
        or key_sets[0] & key_sets[2]
        or key_sets[1] & key_sets[2]
    )
    return strong_keys, distinct_keys


def _seed_security_issues(settings: Settings) -> list[str]:
    seed_endpoint_configured = "seed_s3_endpoint" in settings.model_fields_set
    seed_endpoint = urlparse(settings.seed_s3_endpoint)
    seed_issues: list[str] = []
    if seed_endpoint_configured and (
        seed_endpoint.scheme != "https" or not seed_endpoint.hostname
    ):
        seed_issues.append("SEED_S3_ENDPOINT must use HTTPS")
    seed_secrets = {
        "SEED_S3_SECRET_KEY": (
            settings.seed_s3_secret_key if seed_endpoint_configured else None
        ),
        "SEED_RGW_ADMIN_SECRET_KEY": settings.seed_rgw_admin_secret_key,
        "SEED_SUPERVISION_SECRET_KEY": settings.seed_supervision_secret_key,
    }
    for name, value in seed_secrets.items():
        if value is not None and is_weak_secret_value(value):
            seed_issues.append(f"{name} is weak/default")
    return seed_issues


def _scheduler_token_finding(
    settings: Settings,
    *,
    production: bool,
) -> DeploymentCheckFinding:
    cron_weak = is_weak_secret_value(settings.internal_cron_token)
    if settings.scheduled_jobs_enabled:
        return finding(
            "cron-token",
            "Scheduler token",
            passed=not cron_weak,
            severity="blocker",
            pass_message="The internal scheduler token is strong.",
            fail_message="INTERNAL_CRON_TOKEN must be a strong non-default secret while scheduled jobs are enabled.",
            docs_anchor="scheduler-token",
            blocks_startup=production,
        )
    return finding(
        "cron-token",
        "Scheduler token",
        passed=settings.internal_cron_token is None or not cron_weak,
        severity="warning",
        pass_message="Scheduled jobs are disabled or the configured internal token is strong.",
        fail_message="A weak INTERNAL_CRON_TOKEN is configured even though scheduled jobs are disabled; remove or rotate it.",
        docs_anchor="scheduler-token",
    )


def runtime_configuration_findings(settings: Settings) -> list[DeploymentCheckFinding]:
    production = settings.app_env == "production"
    findings = [
        finding(
            "app-env",
            "Production environment",
            passed=production,
            severity="critical",
            pass_message="APP_ENV is production.",
            fail_message="APP_ENV is not production; use this report as a preflight before publication.",
        ),
        *_browser_boundary_findings(settings, production=production),
        *_secret_findings(settings, production=production),
        *environment_oidc_findings(settings),
        *environment_ldap_findings(settings),
    ]
    return findings
