# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import json
import os
import subprocess
import sys

from app.core.config import Settings
from app.core.runtime_surfaces import runtime_surface_enabled


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

    assert "/api/auth/session" in paths
    assert "/health" in paths


def test_ceph_admin_high_security_mounts_only_ceph_admin_runtime_surface() -> None:
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "test",
            "CEPH_ADMIN_HIGH_SECURITY_MODE": "true",
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
    assert "/api/users/me" in paths
