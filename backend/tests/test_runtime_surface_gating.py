# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest
from pydantic import ValidationError

from app.core.config import Settings
from app.core.runtime_surfaces import ceph_admin_only_runtime, runtime_surface_enabled


def test_runtime_surface_kill_switch_defaults_to_mounted() -> None:
    settings = Settings(_env_file=None)
    assert runtime_surface_enabled(settings, "admin") is True
    assert runtime_surface_enabled(settings, "manager") is True


def test_runtime_surface_kill_switch_explicit_false_wins() -> None:
    settings = Settings(
        _env_file=None,
        runtime_surfaces=["ceph_admin", "storage_ops", "portal", "browser"],
    )
    assert runtime_surface_enabled(settings, "admin") is False
    assert runtime_surface_enabled(settings, "manager") is False


def test_disabled_runtime_surfaces_are_not_mounted() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "RUNTIME_SURFACES": '[]',
            "SCHEDULED_JOBS_ENABLED": "false",
        }
    )
    code = """
import json
from app.main import app
print(json.dumps(sorted(app.openapi()["paths"])))
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=os.path.dirname(os.path.dirname(__file__)),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    paths = json.loads(result.stdout.strip().splitlines()[-1])
    disabled_prefixes = (
        "/api/admin",
        "/api/ceph-admin",
        "/api/storage-ops",
        "/api/manager",
        "/api/portal",
        "/api/browser",
        "/api/internal/cost",
        "/api/internal/healthchecks",
        "/api/internal/quota-monitor",
        "/api/internal/usage-history",
        "/api/internal/notifications",
    )
    for prefix in disabled_prefixes:
        assert not any(path == prefix or path.startswith(f"{prefix}/") for path in paths)

    assert "/api/auth/api-tokens" not in paths
    assert "/api/auth/bootstrap/first-admin" not in paths
    assert "/api/auth/bootstrap/first-admin/status" not in paths
    assert "/api/auth/session" in paths
    assert "/health" in paths


def test_ceph_admin_only_full_mounts_only_ceph_admin_runtime_surface() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "DEPLOYMENT_PROFILE": "full",
            "RUNTIME_SURFACES": '["ceph_admin"]',
            "SCHEDULED_JOBS_ENABLED": "false",
        }
    )
    code = """
import json
from app.main import app
print(json.dumps(sorted(app.openapi()["paths"])))
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=os.path.dirname(os.path.dirname(__file__)),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    paths = json.loads(result.stdout.strip().splitlines()[-1])

    assert any(path.startswith("/api/ceph-admin/") for path in paths)
    for prefix in (
        "/api/admin",
        "/api/storage-ops",
        "/api/manager",
        "/api/portal",
        "/api/browser",
        "/api/internal/",
        "/api/connections",
        "/api/me/execution-contexts",
    ):
        assert not any(path == prefix.rstrip("/") or path.startswith(prefix) for path in paths)

    assert "/api/auth/session" in paths
    assert "/api/auth/api-tokens" not in paths
    assert "/api/auth/bootstrap/first-admin" in paths
    assert "/api/auth/bootstrap/first-admin/status" in paths
    assert "/api/users/me" in paths


def test_user_profile_does_not_mount_admin_control_plane_auth_routes() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "DEPLOYMENT_PROFILE": "user",
            "SCHEDULED_JOBS_ENABLED": "false",
        }
    )
    code = """
import json
from app.main import app
print(json.dumps(sorted(app.openapi()["paths"])))
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=os.path.dirname(os.path.dirname(__file__)),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    paths = json.loads(result.stdout.strip().splitlines()[-1])

    assert "/api/auth/api-tokens" not in paths
    assert "/api/auth/bootstrap/first-admin" not in paths
    assert "/api/auth/bootstrap/first-admin/status" not in paths
    assert "/api/auth/session" in paths


def test_admin_profile_keeps_portal_control_plane_without_mounting_portal_runtime() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "DEPLOYMENT_PROFILE": "admin",
            "SCHEDULED_JOBS_ENABLED": "false",
        }
    )
    code = """
import json
from app.main import app
print(json.dumps(sorted(app.openapi()["paths"])))
"""
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=os.path.dirname(os.path.dirname(__file__)),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    paths = json.loads(result.stdout.strip().splitlines()[-1])

    assert "/api/admin/portal-requests" in paths
    assert any(path.startswith("/api/admin/") for path in paths)
    assert not any(path == "/api/portal" or path.startswith("/api/portal/") for path in paths)


@pytest.mark.parametrize("profile", ["admin-no-ceph-admin", "ceph-admin-high-security"])
def test_removed_deployment_profiles_are_rejected(profile):
    with pytest.raises(ValidationError, match="deployment_profile"):
        Settings(_env_file=None, deployment_profile=profile)


@pytest.mark.parametrize("profile", ["full", "admin", "user"])
@pytest.mark.parametrize("extra_surface", [None, "admin", "storage_ops", "manager", "portal", "browser"])
def test_ceph_admin_only_detection_requires_all_other_surfaces_off(profile, extra_surface):
    surfaces = ["ceph_admin"] + ([extra_surface] if extra_surface else [])
    if profile != "full":
        with pytest.raises(ValidationError, match="profile"):
            Settings(_env_file=None, deployment_profile=profile, runtime_surfaces=surfaces)
        return
    settings = Settings(_env_file=None, deployment_profile=profile, runtime_surfaces=surfaces)
    assert ceph_admin_only_runtime(settings) is (extra_surface is None)


def test_mixed_runtime_without_admin_does_not_mount_bootstrap():
    env = os.environ.copy()
    env.update({
        "APP_ENV": "test", "DEPLOYMENT_PROFILE": "full",
        "RUNTIME_SURFACES": '["ceph_admin", "manager"]',
            "SCHEDULED_JOBS_ENABLED": "false",
    })
    result = subprocess.run(
        [sys.executable, "-c", 'import json; from app.main import app; print(json.dumps(sorted(app.openapi()["paths"])))'],
        cwd=os.path.dirname(os.path.dirname(__file__)), env=env, check=True, capture_output=True, text=True,
    )
    paths = json.loads(result.stdout.strip().splitlines()[-1])
    assert any(path.startswith("/api/ceph-admin/") for path in paths)
    assert any(path.startswith("/api/manager/") for path in paths)
    assert "/api/auth/bootstrap/first-admin" not in paths
    assert "/api/auth/api-tokens" not in paths


def test_legacy_runtime_configuration_fails_closed_without_echoing_values(monkeypatch):
    from app.core.config import _check_retired_deployment_settings

    monkeypatch.setenv("ENV_STORAGE_ENDPOINTS", "private-inventory-value")
    with pytest.raises(ValueError, match="Retired deployment settings") as error:
        _check_retired_deployment_settings()
    assert "ENV_STORAGE_ENDPOINTS" in str(error.value)
    assert "private-inventory-value" not in str(error.value)
