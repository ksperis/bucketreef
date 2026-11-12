# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from app.core.config import Settings

RuntimeSurface = Literal["admin", "ceph_admin", "storage_ops", "manager", "portal", "browser"]

_ADMIN_SURFACES = frozenset(("admin", "ceph_admin", "storage_ops"))
_USER_SURFACES = frozenset(("manager", "portal", "browser"))
PROFILE_SURFACES = {
    "full": _ADMIN_SURFACES | _USER_SURFACES,
    "admin": _ADMIN_SURFACES,
    "user": _USER_SURFACES,
}


def validate_runtime_surfaces(profile: str, surfaces: list[RuntimeSurface] | None) -> None:
    if surfaces is None:
        return
    selected = set(surfaces)
    if len(selected) != len(surfaces):
        raise ValueError("RUNTIME_SURFACES must not contain duplicate surfaces.")
    if profile == "admin" and selected not in (_ADMIN_SURFACES, _ADMIN_SURFACES - {"ceph_admin"}):
        raise ValueError("The admin profile requires admin and storage_ops and permits ceph_admin.")
    if profile == "user" and selected != _USER_SURFACES:
        raise ValueError("The user profile requires manager, portal and browser only.")


def runtime_surface_enabled(settings: Settings, surface: RuntimeSurface) -> bool:
    """Return whether this instance mounts the surface."""
    surfaces = settings.runtime_surfaces
    return surface in (PROFILE_SURFACES[settings.deployment_profile] if surfaces is None else surfaces)


def ceph_admin_only_runtime(settings: Settings) -> bool:
    return (
        settings.deployment_profile == "full"
        and settings.runtime_surfaces == ["ceph_admin"]
    )


def endpoint_identity_management_enabled(settings: Settings) -> bool:
    return runtime_surface_enabled(settings, "admin") or ceph_admin_only_runtime(settings)
