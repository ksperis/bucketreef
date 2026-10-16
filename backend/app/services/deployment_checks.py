# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.config import DeploymentProfile, Settings
from app.models.app_settings import AppSettings
from app.services.deployment_check_models import (
    CheckLevel,
    CheckPhase,
    DeploymentCheckFinding,
    ReadinessStatus,
    finding as _finding,
    manual_finding as _manual,
)
from app.services.deployment_identity_checks import persisted_provider_findings
from app.services.deployment_outbound_preflight import find_uncovered_outbound_targets
from app.services.deployment_persisted_security_checks import persisted_security_findings
from app.services.deployment_profile_checks import database_profile_findings
from app.services.deployment_runtime_checks import runtime_configuration_findings


def _app_settings_findings(
    settings: Settings,
    app_settings: AppSettings | None,
) -> list[DeploymentCheckFinding]:
    if app_settings is None:
        return [
            _finding(
                "app-settings",
                "Application settings",
                passed=False,
                severity="critical",
                pass_message="Application settings are available.",
                fail_message="Application settings could not be loaded; application-level security checks are incomplete.",
            )
        ]

    access_key_login_safe = (
        not app_settings.general.allow_login_access_keys
        or settings.require_registered_s3_login_endpoints
        or not app_settings.general.allow_login_custom_endpoint
    )
    return [
        _finding(
            "app-settings",
            "Application settings",
            passed=True,
            severity="critical",
            pass_message="Application settings are available for readiness checks.",
            fail_message="Application settings could not be loaded.",
        ),
        _finding(
            "admin-passkey-policy",
            "Administrator passkey policy",
            passed=app_settings.general.require_passkey_for_admins,
            severity="critical",
            pass_message="Administrator passkeys are required.",
            fail_message=(
                "Enroll an administrator passkey, then enable 'Require passkeys for administrators' before production."
            ),
        ),
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
        ),
    ]


def _persisted_findings(settings: Settings, db: Session) -> list[DeploymentCheckFinding]:
    findings = [
        *persisted_security_findings(db),
        *persisted_provider_findings(settings, db),
    ]
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
    return findings


def _manual_findings(profile: DeploymentProfile) -> list[DeploymentCheckFinding]:
    findings = [
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
    if profile in {"admin", "user"}:
        findings.append(
            _manual(
                "manual-split-state",
                "Split deployment shared state",
                "Compare the admin and user runtimes to confirm the intended database, key rings, origins, and single scheduler owner.",
                docs_anchor="split-deployment-contract",
            )
        )
    return findings


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
    findings = runtime_configuration_findings(settings)

    if phase == "full":
        findings.extend(_app_settings_findings(settings, app_settings))

    findings.extend(database_profile_findings(settings, profile))
    if phase == "full" and db is not None:
        findings.extend(_persisted_findings(settings, db))

    if phase == "full" and include_manual:
        findings.extend(_manual_findings(profile))

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
