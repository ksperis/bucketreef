# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.core.config import Settings
from app.models.app_settings import AppSettings
from app.services.deployment_checks import run_deployment_checks, startup_blocking_findings


def _app_settings() -> AppSettings:
    settings = AppSettings()
    settings.general.require_passkey_for_admins = True
    return settings


def _base_settings(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "public_origin": "https://app.example.test",
        "webauthn_origin": "https://app.example.test",
        "webauthn_rp_id": "app.example.test",
        "refresh_token_cookie_secure": True,
        "allowed_hosts": ["app.example.test"],
        "trusted_proxy_cidrs": ["10.0.0.10/32"],
        "cors_origins": ["https://app.example.test"],
        "jwt_keys": ["legacy-jwt-key-that-is-at-least-32-bytes"],
        "ui_jwt_keys": ["ui-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "api_jwt_keys": ["api-jwt-key-that-is-distinct-and-at-least-32-bytes"],
        "credential_keys": ["credential-key-that-is-at-least-32-bytes"],
        "internal_cron_token": "internal-cron-token-that-is-at-least-32-bytes",
        "require_registered_s3_login_endpoints": True,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _checks(settings: Settings):
    return run_deployment_checks(
        settings,
        app_settings=_app_settings(),
        include_manual=False,
    )


def test_weak_default_keys_block_production_startup():
    findings = _checks(
        _base_settings(
            ui_jwt_keys=["change-me"],
            api_jwt_keys=["another-change-me"],
            credential_keys=["default"],
        )
    )

    blockers = startup_blocking_findings(findings)

    assert any(finding.code == "key-strength" for finding in blockers)


def test_pre_database_phase_reports_config_blockers_without_database_dependent_checks():
    findings = run_deployment_checks(
        _base_settings(ui_jwt_keys=["change-me"]),
        app_settings=None,
        include_manual=True,
        phase="pre-database",
    )

    assert any(finding.code == "key-strength" for finding in startup_blocking_findings(findings))
    assert not any(finding.code == "app-settings" for finding in findings)
    assert not any(finding.result == "manual" for finding in findings)


def test_same_weak_keys_do_not_block_development_startup():
    findings = _checks(
        _base_settings(
            app_env="development",
            ui_jwt_keys=["change-me"],
            api_jwt_keys=["another-change-me"],
            credential_keys=["default"],
        )
    )

    assert next(finding for finding in findings if finding.code == "key-strength").level == "blocked"
    assert startup_blocking_findings(findings) == []


def test_insecure_public_authentication_cookie_blocks_production_startup():
    findings = _checks(_base_settings(refresh_token_cookie_secure=False))

    blockers = startup_blocking_findings(findings)

    assert any(finding.code == "authentication-cookie-secure" for finding in blockers)


def test_critical_admin_passkey_policy_does_not_block_startup():
    app_settings = AppSettings()
    app_settings.general.require_passkey_for_admins = False
    findings = run_deployment_checks(
        _base_settings(),
        app_settings=app_settings,
        include_manual=False,
    )

    finding = next(finding for finding in findings if finding.code == "admin-passkey-policy")
    assert finding.level == "critical"
    assert finding.blocks_startup is False
    assert finding not in startup_blocking_findings(findings)


def test_empty_trusted_proxy_boundary_is_warning_only():
    findings = _checks(_base_settings(trusted_proxy_cidrs=[]))

    finding = next(finding for finding in findings if finding.code == "trusted-proxies")
    assert finding.level == "warning"
    assert finding.blocks_startup is False


def test_global_trusted_proxy_boundary_blocks_production_startup():
    findings = _checks(_base_settings(trusted_proxy_cidrs=["0.0.0.0/0"]))

    blockers = startup_blocking_findings(findings)

    assert any(finding.code == "trusted-proxies" for finding in blockers)


def test_sqlite_bucket_migration_worker_is_warning_only():
    findings = _checks(
        _base_settings(
            database_url="sqlite:////tmp/test.db",
            bucket_migration_worker_enabled=True,
        )
    )

    finding = next(finding for finding in findings if finding.code == "sqlite-bucket-migration-worker")
    assert finding.level == "warning"
    assert finding.blocks_startup is False


def test_high_security_profile_contract_blocks_even_before_production_publication():
    settings = _base_settings(
        app_env="development",
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
    findings = _checks(settings)

    blocker = next(finding for finding in startup_blocking_findings(findings) if finding.code == "surface-admin")

    assert blocker.level == "blocked"
