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
        feature_admin_enabled=False,
        feature_manager_enabled=False,
    )
    assert runtime_surface_enabled(settings, "admin") is False
    assert runtime_surface_enabled(settings, "manager") is False


def test_disabled_runtime_surfaces_are_not_mounted() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "FEATURE_ADMIN_ENABLED": "false",
            "FEATURE_CEPH_ADMIN_ENABLED": "false",
            "FEATURE_STORAGE_OPS_ENABLED": "false",
            "FEATURE_MANAGER_ENABLED": "false",
            "FEATURE_PORTAL_ENABLED": "false",
            "FEATURE_BROWSER_ENABLED": "false",
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
        "/api/internal/billing",
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
            "FEATURE_ADMIN_ENABLED": "false",
            "FEATURE_CEPH_ADMIN_ENABLED": "true",
            "FEATURE_STORAGE_OPS_ENABLED": "false",
            "FEATURE_MANAGER_ENABLED": "false",
            "FEATURE_PORTAL_ENABLED": "false",
            "FEATURE_BROWSER_ENABLED": "false",
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
            "FEATURE_ADMIN_ENABLED": "false",
            "FEATURE_CEPH_ADMIN_ENABLED": "false",
            "FEATURE_STORAGE_OPS_ENABLED": "false",
            "FEATURE_MANAGER_ENABLED": "true",
            "FEATURE_PORTAL_ENABLED": "true",
            "FEATURE_BROWSER_ENABLED": "true",
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


@pytest.mark.parametrize("profile", ["admin-no-ceph-admin", "ceph-admin-high-security"])
def test_removed_deployment_profiles_are_rejected(profile):
    with pytest.raises(ValidationError, match="deployment_profile"):
        Settings(_env_file=None, deployment_profile=profile)


@pytest.mark.parametrize("profile", ["full", "admin", "user"])
@pytest.mark.parametrize("extra_surface", [None, "admin", "storage_ops", "manager", "portal", "browser"])
def test_ceph_admin_only_detection_requires_all_other_surfaces_off(profile, extra_surface):
    switches = {
        f"feature_{surface}_enabled": False
        for surface in ("admin", "storage_ops", "manager", "portal", "browser")
    }
    if extra_surface:
        switches[f"feature_{extra_surface}_enabled"] = True
    settings = Settings(
        _env_file=None, deployment_profile=profile, feature_ceph_admin_enabled=True, **switches,
    )
    assert ceph_admin_only_runtime(settings) is (profile == "full" and extra_surface is None)


def test_mixed_runtime_without_admin_does_not_mount_bootstrap():
    env = os.environ.copy()
    env.update({
        "APP_ENV": "test", "DEPLOYMENT_PROFILE": "full",
        "FEATURE_ADMIN_ENABLED": "false", "FEATURE_CEPH_ADMIN_ENABLED": "true",
        "FEATURE_STORAGE_OPS_ENABLED": "false", "FEATURE_MANAGER_ENABLED": "true",
        "FEATURE_PORTAL_ENABLED": "false", "FEATURE_BROWSER_ENABLED": "false",
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
