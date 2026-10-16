# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from app.core.config import DeploymentProfile, Settings
from app.core.database import is_sqlite_url
from app.core.runtime_surfaces import RuntimeSurface, ceph_admin_only_runtime, runtime_surface_enabled
from app.services.deployment_check_models import CheckSeverity, DeploymentCheckFinding, finding


_PROFILE_SURFACES: dict[DeploymentProfile, dict[RuntimeSurface, bool]] = {
    "full": {},
    "admin": {
        "admin": True,
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
}


def _is_postgresql(url: str) -> bool:
    text = str(url or "").strip().lower()
    return text.startswith("postgresql") or text.startswith("postgres")


def _database_findings(
    settings: Settings,
    profile: DeploymentProfile,
) -> list[DeploymentCheckFinding]:
    postgresql = _is_postgresql(settings.database_url)
    database_severity: CheckSeverity = "critical" if profile != "full" or settings.backend_replicas > 1 else "warning"
    return [
        finding(
            "database",
            "Database topology",
            passed=postgresql,
            severity=database_severity,
            pass_message=(
                "PostgreSQL is configured."
                if postgresql
                else "SQLite is used by a single full-profile backend; PostgreSQL remains recommended for production."
            ),
            fail_message=(
                "SQLite is suitable only for a single full-profile backend; PostgreSQL is recommended for production."
                if database_severity == "warning"
                else "Split or multi-replica deployments require PostgreSQL."
            ),
            docs_anchor="database-topology",
        ),
        finding(
            "sqlite-bucket-migration-worker",
            "SQLite migration worker",
            passed=not (is_sqlite_url(settings.database_url) and settings.bucket_migration_worker_enabled),
            severity="warning",
            pass_message="The bucket migration worker is not combined with SQLite, or PostgreSQL is configured.",
            fail_message=(
                "SQLite is configured while the bucket migration worker is enabled; PostgreSQL is recommended for long-running migrations."
            ),
            docs_anchor="database-topology",
        ),
    ]


def _job_owner_finding(
    settings: Settings,
    profile: DeploymentProfile,
) -> DeploymentCheckFinding:
    if profile in {"admin", "user"}:
        expected_jobs = profile == "admin"
        return finding(
            "job-owner",
            "Scheduled job ownership",
            passed=settings.scheduled_jobs_enabled is expected_jobs,
            severity="critical",
            pass_message="Scheduled-job ownership matches the deployment profile.",
            fail_message=(
                "The administration profile must own scheduled jobs."
                if expected_jobs
                else "This deployment profile must disable scheduled jobs."
            ),
            docs_anchor="scheduled-job-ownership",
        )
    return finding(
        "job-owner",
        "Scheduled job ownership",
        passed=settings.scheduled_jobs_enabled or ceph_admin_only_runtime(settings),
        severity="warning",
        pass_message="This full-profile instance owns scheduled jobs or intentionally runs only Ceph Admin.",
        fail_message="Scheduled jobs are disabled on this full-profile instance; verify they are intentionally run elsewhere.",
        docs_anchor="scheduled-job-ownership",
    )


def _surface_findings(
    settings: Settings,
    profile: DeploymentProfile,
) -> list[DeploymentCheckFinding]:
    split_surface_contract = profile in {"admin", "user"}
    production = settings.app_env == "production"
    findings: list[DeploymentCheckFinding] = []
    for surface, expected in _PROFILE_SURFACES[profile].items():
        enabled = runtime_surface_enabled(settings, surface)
        blocks_startup = production and split_surface_contract
        findings.append(
            finding(
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
    return findings


def _split_origin_findings(settings: Settings) -> list[DeploymentCheckFinding]:
    public_origins = settings.effective_public_origins()
    webauthn_origins = settings.effective_webauthn_origins()
    return [
        finding(
            "shared-origins",
            "Split deployment public origins",
            passed=len(public_origins) >= 2,
            severity="critical",
            pass_message="Multiple trusted public origins are configured for the split deployment.",
            fail_message="Split admin/user deployments must configure both public origins on each backend.",
            docs_anchor="split-deployment-contract",
        ),
        finding(
            "webauthn-origins",
            "Split deployment WebAuthn origins",
            passed=set(webauthn_origins) == set(public_origins),
            severity="critical",
            pass_message="WebAuthn accepts the same trusted origins as the split deployment.",
            fail_message="WebAuthn origins must cover every trusted public origin in a split deployment.",
            docs_anchor="split-deployment-contract",
        ),
    ]


def database_profile_findings(
    settings: Settings,
    profile: DeploymentProfile,
) -> list[DeploymentCheckFinding]:
    findings = _database_findings(settings, profile)
    findings.append(_job_owner_finding(settings, profile))
    findings.extend(_surface_findings(settings, profile))
    if profile in {"admin", "user"}:
        findings.extend(_split_origin_findings(settings))
    return findings
