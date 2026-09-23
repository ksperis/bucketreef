# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from app.core.config import Settings
from app.models.app_settings import AppSettings
from app.scripts.check_production_hardening import run
from app.services.deployment_checks import deployment_exit_code, run_deployment_checks
from app.services.production_hardening import (
    HardeningFinding,
    check_production_hardening,
    hardening_counts,
    hardening_exit_code,
    hardening_status,
)


def _production_settings(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "public_origin": "https://admin.example.test",
        "public_origins": ["https://app.example.test"],
        "webauthn_origin": "https://admin.example.test",
        "webauthn_origins": ["https://app.example.test"],
        "webauthn_rp_id": "example.test",
        "refresh_token_cookie_secure": True,
        "refresh_token_cookie_samesite": "lax",
        "refresh_token_cookie_domain": None,
        "require_registered_s3_login_endpoints": True,
        "allowed_hosts": ["admin.example.test", "app.example.test"],
        "trusted_proxy_cidrs": ["10.42.7.15/32"],
        "cors_origins": ["https://admin.example.test", "https://app.example.test"],
        "jwt_keys": ["legacy-jwt-key-that-is-at-least-32-bytes"],
        "ui_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "api_jwt_keys": ["api-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "credential_keys": ["credential-key-that-is-at-least-32-bytes"],
        "database_url": "postgresql+psycopg://bucketreef@example.test/bucketreef",
        "internal_cron_token": "internal-cron-token-that-is-at-least-32-bytes",
        "feature_admin_enabled": True,
        "feature_ceph_admin_enabled": True,
        "feature_storage_ops_enabled": True,
        "feature_manager_enabled": False,
        "feature_portal_enabled": False,
        "feature_browser_enabled": False,
        "scheduled_jobs_enabled": True,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _app_settings(*, admin_passkeys_required: bool = True) -> AppSettings:
    settings = AppSettings()
    settings.general.require_passkey_for_admins = admin_passkeys_required
    return settings


def _check(settings: Settings, *, profile: str, admin_passkeys_required: bool = True):
    return run_deployment_checks(
        settings,
        app_settings=_app_settings(admin_passkeys_required=admin_passkeys_required),
        profile=profile,
        include_manual=False,
    )


def _finding(findings, code: str):
    return next(finding for finding in findings if finding.code == code)


def test_legacy_hardening_facade_preserves_three_level_contract():
    warning = HardeningFinding("legacy-check", "warning", "Review this setting.")

    assert hardening_status([warning]) == "warning"
    assert hardening_counts([warning]) == {"pass": 0, "warning": 1, "fail": 0}
    assert hardening_exit_code([warning]) == 0

    findings = check_production_hardening(
        _production_settings(),
        app_settings=_app_settings(),
        profile="admin",
    )
    assert findings
    assert all(finding.level in {"pass", "warning", "fail"} for finding in findings)


def test_admin_profile_passes_automated_deployment_checks():
    findings = _check(_production_settings(), profile="admin")

    assert deployment_exit_code(findings) == 0
    assert all(finding.level == "ok" for finding in findings)


def test_user_profile_reports_topology_mismatches_as_critical_without_startup_block():
    findings = _check(_production_settings(), profile="user")

    assert _finding(findings, "job-owner").level == "critical"
    assert _finding(findings, "surface-admin").level == "critical"
    assert _finding(findings, "surface-manager").level == "critical"
    assert not _finding(findings, "surface-admin").blocks_startup
    assert deployment_exit_code(findings) == 1


def test_user_profile_passes_with_user_surface_contract():
    settings = _production_settings(
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=False,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=True,
        feature_portal_enabled=True,
        feature_browser_enabled=True,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
    )

    findings = _check(settings, profile="user")

    assert deployment_exit_code(findings) == 0
    assert all(finding.level == "ok" for finding in findings)


def test_split_profile_requires_postgresql_and_shared_origins_as_critical_findings():
    settings = Settings(
        _env_file=None,
        database_url="sqlite:////tmp/bucketreef.db",
        public_origin="http://localhost:8080",
        webauthn_origin="http://localhost:8080",
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=False,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=True,
        feature_portal_enabled=True,
        feature_browser_enabled=True,
        scheduled_jobs_enabled=False,
    )

    findings = _check(settings, profile="user")

    assert _finding(findings, "app-env").level == "critical"
    assert _finding(findings, "trusted-origins").level == "critical"
    assert _finding(findings, "database").level == "critical"
    assert _finding(findings, "shared-origins").level == "critical"


@pytest.mark.parametrize(
    ("overrides", "expected_code", "expected_level"),
    [
        (
            {
                "app_env": "development",
                "public_origin": "http://admin.example.test",
                "webauthn_origin": "http://admin.example.test",
            },
            "trusted-origins",
            "critical",
        ),
        (
            {"app_env": "development", "refresh_token_cookie_secure": False},
            "authentication-cookie-secure",
            "blocked",
        ),
        ({"app_env": "development", "allowed_hosts": ["*"]}, "allowed-hosts", "critical"),
        (
            {
                "app_env": "development",
                "credential_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
            },
            "key-separation",
            "critical",
        ),
        (
            {"app_env": "development", "seed_s3_endpoint": "http://seed.example.test"},
            "seed-security",
            "critical",
        ),
        (
            {
                "app_env": "development",
                "oidc_providers": {
                    "corporate": {
                        "display_name": "Corporate",
                        "discovery_url": "https://idp.example.test/.well-known/openid-configuration",
                        "client_id": "bucketreef",
                        "redirect_uri": "https://admin.example.test/api/auth/oidc/corporate/callback",
                        "use_pkce": False,
                    }
                },
            },
            "environment-oidc-integrity",
            "critical",
        ),
        (
            {
                "app_env": "development",
                "ldap_providers": {
                    "corporate": {
                        "display_name": "Corporate",
                        "url": "ldaps://ldap.example.test",
                        "user_base_dn": "ou=users,dc=example,dc=test",
                        "tls_verify": False,
                    }
                },
            },
            "environment-ldap-transport",
            "blocked",
        ),
    ],
)
def test_checker_exposes_production_target_risks_before_app_env_switch(overrides, expected_code, expected_level):
    settings = _production_settings(**overrides)

    findings = _check(settings, profile="admin")

    assert _finding(findings, expected_code).level == expected_level


def test_blocker_only_blocks_startup_in_production_for_general_security_checks():
    development = _production_settings(
        app_env="development",
        refresh_token_cookie_secure=False,
    )
    production = _production_settings(refresh_token_cookie_secure=False)

    dev_finding = _finding(_check(development, profile="admin"), "authentication-cookie-secure")
    prod_finding = _finding(_check(production, profile="admin"), "authentication-cookie-secure")

    assert dev_finding.level == "blocked"
    assert dev_finding.blocks_startup is False
    assert prod_finding.level == "blocked"
    assert prod_finding.blocks_startup is True


def test_empty_trusted_proxy_boundary_is_warning_not_startup_blocker():
    findings = _check(_production_settings(trusted_proxy_cidrs=[]), profile="admin")

    finding = _finding(findings, "trusted-proxies")
    assert finding.level == "warning"
    assert finding.blocks_startup is False


def test_single_full_profile_sqlite_database_is_warning():
    findings = _check(
        _production_settings(
            deployment_profile="full",
            database_url="sqlite:////tmp/bucketreef.db",
            feature_admin_enabled=None,
            feature_ceph_admin_enabled=None,
            feature_storage_ops_enabled=None,
            feature_manager_enabled=None,
            feature_portal_enabled=None,
            feature_browser_enabled=None,
        ),
        profile="full",
    )

    finding = _finding(findings, "database")
    assert finding.level == "warning"
    assert finding.blocks_startup is False


def test_global_trusted_proxy_boundary_is_security_blocker():
    findings = _check(_production_settings(trusted_proxy_cidrs=["0.0.0.0/0"]), profile="admin")

    finding = _finding(findings, "trusted-proxies")
    assert finding.level == "blocked"
    assert finding.blocks_startup is True


def test_samesite_strict_is_accepted_as_secure_cookie_scope():
    findings = _check(_production_settings(refresh_token_cookie_samesite="strict"), profile="admin")

    assert _finding(findings, "authentication-cookie-scope").level == "ok"


def test_cli_json_output_contains_no_secret_values():
    settings = _production_settings()
    exit_code, output = run(
        profile="admin",
        json_output=True,
        settings=settings,
        app_settings=_app_settings(),
    )

    assert exit_code == 0
    parsed = json.loads(output)
    assert parsed
    assert settings.internal_cron_token not in output
    assert settings.credential_keys[0] not in output
    assert all("documentation_url" in item for item in parsed)


def test_cli_uses_runtime_deployment_profile_when_not_overridden():
    settings = _production_settings(
        deployment_profile="user",
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=False,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=True,
        feature_portal_enabled=True,
        feature_browser_enabled=True,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
    )
    exit_code, output = run(
        json_output=False,
        settings=settings,
        app_settings=_app_settings(),
    )

    assert exit_code == 0
    assert "surface-manager" in output
    assert "CRITICAL surface-manager" not in output


def test_ceph_admin_high_security_profile_passes_with_dedicated_contract():
    settings = _production_settings(
        deployment_profile="ceph-admin-high-security",
        ceph_admin_high_security_mode=True,
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=True,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=False,
        feature_portal_enabled=False,
        feature_browser_enabled=False,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
        public_origins=[],
        webauthn_origins=[],
        public_origin="https://ceph-admin.example.test",
        webauthn_origin="https://ceph-admin.example.test",
        webauthn_rp_id="ceph-admin.example.test",
        allowed_hosts=["ceph-admin.example.test"],
        cors_origins=["https://ceph-admin.example.test"],
    )

    findings = _check(settings, profile="ceph-admin-high-security")

    assert deployment_exit_code(findings) == 0
    assert all(finding.level == "ok" for finding in findings)


def test_ceph_admin_high_security_database_mismatch_is_critical_but_not_boot_blocking():
    settings = _production_settings(
        deployment_profile="ceph-admin-high-security",
        ceph_admin_high_security_mode=True,
        database_url="sqlite:////tmp/bucketreef.db",
        feature_admin_enabled=False,
        feature_ceph_admin_enabled=True,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=False,
        feature_portal_enabled=False,
        feature_browser_enabled=False,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
        public_origins=[],
        webauthn_origins=[],
        public_origin="https://ceph-admin.example.test",
        webauthn_origin="https://ceph-admin.example.test",
        webauthn_rp_id="ceph-admin.example.test",
        allowed_hosts=["ceph-admin.example.test"],
        cors_origins=["https://ceph-admin.example.test"],
    )

    finding = _finding(_check(settings, profile="ceph-admin-high-security"), "database")

    assert finding.level == "critical"
    assert finding.blocks_startup is False


@pytest.mark.parametrize("profile", ["full", "admin", "user", "ceph-admin-high-security"])
def test_admin_passkey_policy_is_critical_not_startup_blocking(profile):
    settings = _production_settings()
    if profile == "ceph-admin-high-security":
        settings = _production_settings(
            deployment_profile="ceph-admin-high-security",
            ceph_admin_high_security_mode=True,
            feature_admin_enabled=False,
            feature_ceph_admin_enabled=True,
            feature_storage_ops_enabled=False,
            feature_manager_enabled=False,
            feature_portal_enabled=False,
            feature_browser_enabled=False,
            scheduled_jobs_enabled=False,
            internal_cron_token=None,
            public_origins=[],
            webauthn_origins=[],
            public_origin="https://ceph-admin.example.test",
            webauthn_origin="https://ceph-admin.example.test",
            webauthn_rp_id="ceph-admin.example.test",
            allowed_hosts=["ceph-admin.example.test"],
            cors_origins=["https://ceph-admin.example.test"],
        )

    finding = _finding(
        _check(settings, profile=profile, admin_passkeys_required=False),
        "admin-passkey-policy",
    )

    assert finding.level == "critical"
    assert finding.blocks_startup is False


def test_high_security_surface_contract_is_reported_as_startup_blocker_instead_of_settings_parse_failure():
    settings = _production_settings(
        deployment_profile="ceph-admin-high-security",
        ceph_admin_high_security_mode=True,
        feature_admin_enabled=True,
        feature_ceph_admin_enabled=True,
        feature_storage_ops_enabled=False,
        feature_manager_enabled=False,
        feature_portal_enabled=False,
        feature_browser_enabled=False,
        scheduled_jobs_enabled=False,
        internal_cron_token=None,
    )

    finding = _finding(_check(settings, profile="ceph-admin-high-security"), "surface-admin")

    assert finding.level == "blocked"
    assert finding.blocks_startup is True


def test_high_security_mode_profile_mismatch_is_startup_blocker():
    settings = _production_settings(
        deployment_profile="full",
        ceph_admin_high_security_mode=True,
    )

    finding = _finding(_check(settings, profile="full"), "high-security-mode")

    assert finding.level == "blocked"
    assert finding.blocks_startup is True


def test_manual_checks_are_reported_without_affecting_cli_exit_code():
    findings = run_deployment_checks(
        _production_settings(),
        app_settings=_app_settings(),
        profile="admin",
        include_manual=True,
    )

    manual = [finding for finding in findings if finding.level == "manual"]
    assert manual
    assert deployment_exit_code(findings) == 0
    assert all(finding.documentation_url.startswith("https://docs.bucketreef.ksperis.com/") for finding in manual)


def test_every_reported_check_links_to_an_existing_documentation_anchor(db_session):
    documentation = (
        Path(__file__).resolve().parents[2] / "doc" / "docs" / "ops" / "production-checks-reference.md"
    ).read_text(encoding="utf-8")
    anchors: set[str] = set()
    for line in documentation.splitlines():
        if not line.startswith("#"):
            continue
        heading = line.lstrip("#").strip().replace("`", "").lower()
        anchor = re.sub(r"[^a-z0-9 -]", "", heading).replace(" ", "-")
        anchor = re.sub(r"-+", "-", anchor).strip("-")
        if anchor:
            anchors.add(anchor)

    for profile in ("full", "admin", "user", "ceph-admin-high-security"):
        findings = run_deployment_checks(
            _production_settings(),
            app_settings=_app_settings(),
            profile=profile,
            db=db_session,
            include_manual=True,
        )

        for finding in findings:
            fragment = finding.documentation_url.partition("#")[2]
            assert fragment in anchors, f"Missing documentation anchor for {profile}/{finding.code}: {fragment}"


def test_cli_reports_app_settings_load_failure_as_critical(monkeypatch):
    def fail_load():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr("app.scripts.check_production_hardening.load_app_settings", fail_load)

    exit_code, output = run(profile="admin", settings=_production_settings())

    assert exit_code == 1
    assert "CRITICAL app-settings:" in output
    assert "database unavailable" not in output
