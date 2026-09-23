# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal

from app.core.config import Settings


RuntimeSurface = Literal[
    "admin",
    "ceph_admin",
    "storage_ops",
    "manager",
    "portal",
    "browser",
]

RUNTIME_SURFACE_ENV: dict[RuntimeSurface, tuple[str, str]] = {
    "admin": ("feature_admin_enabled", "FEATURE_ADMIN_ENABLED"),
    "ceph_admin": ("feature_ceph_admin_enabled", "FEATURE_CEPH_ADMIN_ENABLED"),
    "storage_ops": ("feature_storage_ops_enabled", "FEATURE_STORAGE_OPS_ENABLED"),
    "manager": ("feature_manager_enabled", "FEATURE_MANAGER_ENABLED"),
    "portal": ("feature_portal_enabled", "FEATURE_PORTAL_ENABLED"),
    "browser": ("feature_browser_enabled", "FEATURE_BROWSER_ENABLED"),
}


def runtime_surface_enabled(settings: Settings, surface: RuntimeSurface) -> bool:
    """Return whether a surface may be mounted by this backend instance."""

    setting_name, _ = RUNTIME_SURFACE_ENV[surface]
    return getattr(settings, setting_name) is not False


def runtime_surface_source(settings: Settings, surface: RuntimeSurface) -> str | None:
    setting_name, env_name = RUNTIME_SURFACE_ENV[surface]
    return env_name if getattr(settings, setting_name) is not None else None
