# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.core.config import DeploymentProfile, Settings, is_weak_secret_value
from app.core.runtime_surfaces import RuntimeSurface, runtime_surface_enabled


HardeningLevel = Literal["pass", "warning", "fail"]


@dataclass(frozen=True)
class HardeningFinding:
    code: str
    level: HardeningLevel
    message: str


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

_FINDING_LABELS: dict[str, str] = {
    "app-env": "Production environment",
    "keyrings": "Secret key rings",
    "database": "Database",
    "job-owner": "Scheduled job ownership",
    "cron-token": "Scheduler token",
    "high-security-mode": "Ceph Admin high-security mode",
    "shared-origins": "Trusted public origins",
    "webauthn-origins": "WebAuthn origins",
}


def hardening_finding_label(code: str) -> str:
    if code.startswith("surface-"):
        surface = code.removeprefix("surface-").replace("-", " ")
        return f"Runtime surface: {surface.title()}"
    return _FINDING_LABELS.get(code, code.replace("-", " ").title())


def hardening_status(findings: list[HardeningFinding]) -> HardeningLevel:
    if any(finding.level == "fail" for finding in findings):
        return "fail"
    if any(finding.level == "warning" for finding in findings):
        return "warning"
    return "pass"


def hardening_counts(findings: list[HardeningFinding]) -> dict[HardeningLevel, int]:
    counts: dict[HardeningLevel, int] = {"pass": 0, "warning": 0, "fail": 0}
    for finding in findings:
        counts[finding.level] += 1
    return counts


def _is_postgresql(url: str) -> bool:
    text = str(url or "").strip().lower()
    return text.startswith("postgresql") or text.startswith("postgres")


def _secret_ring_is_strong(values: list[str]) -> bool:
    return bool(values) and all(not is_weak_secret_value(value) for value in values)


def check_production_hardening(
    settings: Settings,
    *,
    profile: DeploymentProfile | None = None,
) -> list[HardeningFinding]:
    profile = profile or settings.deployment_profile
    findings: list[HardeningFinding] = []

    findings.append(
        HardeningFinding(
            "app-env",
            "pass" if settings.app_env == "production" else "fail",
            "APP_ENV is production."
            if settings.app_env == "production"
            else "APP_ENV must be production for a hardened deployment.",
        )
    )

    keyrings_ok = (
        _secret_ring_is_strong(settings.effective_ui_jwt_keys())
        and _secret_ring_is_strong(settings.effective_api_jwt_keys())
        and _secret_ring_is_strong(settings.credential_keys)
        and not (set(settings.effective_ui_jwt_keys()) & set(settings.effective_api_jwt_keys()))
    )
    findings.append(
        HardeningFinding(
            "keyrings",
            "pass" if keyrings_ok else "fail",
            "UI/API JWT and credential key rings are strong and separated."
            if keyrings_ok
            else "Use strong credential keys and distinct UI/API JWT key rings.",
        )
    )

    postgresql = _is_postgresql(settings.database_url)
    if profile in {"admin", "user", "ceph-admin-high-security"}:
        findings.append(
            HardeningFinding(
                "database",
                "pass" if postgresql else "fail",
                (
                    "Dedicated Ceph Admin deployment uses PostgreSQL."
                    if profile == "ceph-admin-high-security"
                    else "Split deployment uses PostgreSQL."
                )
                if postgresql
                else (
                    "Ceph Admin high-security deployments require PostgreSQL; the database may be shared or isolated."
                    if profile == "ceph-admin-high-security"
                    else "Split admin/user deployments require PostgreSQL and must use the same database."
                ),
            )
        )
    elif settings.backend_replicas > 1 and not postgresql:
        findings.append(
            HardeningFinding(
                "database",
                "fail",
                "Multiple backend replicas require PostgreSQL.",
            )
        )
    else:
        findings.append(
            HardeningFinding(
                "database",
                "pass" if postgresql else "warning",
                "PostgreSQL is configured."
                if postgresql
                else "SQLite is suitable only for a single-instance deployment; PostgreSQL is recommended for production.",
            )
        )

    if profile in {"admin", "user", "ceph-admin-high-security"}:
        expected_jobs = profile == "admin"
        findings.append(
            HardeningFinding(
                "job-owner",
                "pass" if settings.scheduled_jobs_enabled is expected_jobs else "fail",
                "Scheduled-job ownership matches the deployment profile."
                if settings.scheduled_jobs_enabled is expected_jobs
                else (
                    "The admin profile must own scheduled jobs."
                    if expected_jobs
                    else "This profile must disable scheduled jobs."
                ),
            )
        )
    else:
        findings.append(
            HardeningFinding(
                "job-owner",
                "pass" if settings.scheduled_jobs_enabled else "warning",
                "This instance owns scheduled jobs."
                if settings.scheduled_jobs_enabled
                else "Scheduled jobs are disabled on this full-profile instance.",
            )
        )

    if settings.scheduled_jobs_enabled:
        cron_token_ok = not is_weak_secret_value(settings.internal_cron_token)
        findings.append(
            HardeningFinding(
                "cron-token",
                "pass" if cron_token_ok else "fail",
                "Internal scheduler token is strong."
                if cron_token_ok
                else "INTERNAL_CRON_TOKEN must be a strong non-default secret when scheduled jobs are enabled.",
            )
        )

    for surface, expected in _PROFILE_SURFACES[profile].items():
        enabled = runtime_surface_enabled(settings, surface)
        findings.append(
            HardeningFinding(
                f"surface-{surface.replace('_', '-')}",
                "pass" if enabled is expected else "fail",
                f"Runtime surface {surface} is {'enabled' if expected else 'disabled'} as required by profile {profile}."
                if enabled is expected
                else f"Runtime surface {surface} must be {'enabled' if expected else 'disabled'} for profile {profile}.",
            )
        )

    if profile == "ceph-admin-high-security":
        findings.append(
            HardeningFinding(
                "high-security-mode",
                "pass" if settings.ceph_admin_high_security_mode else "fail",
                "Ceph Admin high-security runtime mode is enabled."
                if settings.ceph_admin_high_security_mode
                else "CEPH_ADMIN_HIGH_SECURITY_MODE must be enabled for this profile.",
            )
        )

    if profile in {"admin", "user"}:
        public_origins = settings.effective_public_origins()
        webauthn_origins = settings.effective_webauthn_origins()
        findings.append(
            HardeningFinding(
                "shared-origins",
                "pass" if len(public_origins) >= 2 else "fail",
                "Multiple trusted public origins are configured for the split deployment."
                if len(public_origins) >= 2
                else "Split admin/user deployments must configure both public origins on each backend.",
            )
        )
        findings.append(
            HardeningFinding(
                "webauthn-origins",
                "pass" if set(webauthn_origins) == set(public_origins) else "fail",
                "WebAuthn accepts the same trusted origins as the split deployment."
                if set(webauthn_origins) == set(public_origins)
                else "WEBAUTHN_ORIGIN/WEBAUTHN_ORIGINS must cover every trusted public origin in a split deployment.",
            )
        )

    return findings


def hardening_exit_code(findings: list[HardeningFinding]) -> int:
    return 1 if any(finding.level == "fail" for finding in findings) else 0
