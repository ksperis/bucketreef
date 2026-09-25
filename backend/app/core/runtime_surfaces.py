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

RUNTIME_SURFACE_SETTINGS: dict[RuntimeSurface, str] = {
    "admin": "feature_admin_enabled",
    "ceph_admin": "feature_ceph_admin_enabled",
    "storage_ops": "feature_storage_ops_enabled",
    "manager": "feature_manager_enabled",
    "portal": "feature_portal_enabled",
    "browser": "feature_browser_enabled",
}


def runtime_surface_enabled(settings: Settings, surface: RuntimeSurface) -> bool:
    """Return whether a surface may be mounted by this backend instance."""

    setting_name = RUNTIME_SURFACE_SETTINGS[surface]
    return getattr(settings, setting_name) is not False
