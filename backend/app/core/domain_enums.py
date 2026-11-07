# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Shared domain enums independent from persistence models."""

from enum import Enum
from typing import Literal


class UserRole(str, Enum):
    UI_SUPERADMIN = "ui_superadmin"
    UI_ADMIN = "ui_admin"
    UI_USER = "ui_user"
    UI_NONE = "ui_none"


ADMIN_UI_ROLES = {
    UserRole.UI_SUPERADMIN.value,
    UserRole.UI_ADMIN.value,
}


def is_admin_ui_role(role: str | None) -> bool:
    return bool(role in ADMIN_UI_ROLES)


def is_superadmin_ui_role(role: str | None) -> bool:
    return role == UserRole.UI_SUPERADMIN.value


class StorageProvider(str, Enum):
    CEPH = "ceph"
    AWS = "aws"
    OTHER = "other"


class ManagerAccountRole(str, Enum):
    ACCOUNT_ADMINISTRATOR = "account_administrator"


class PortalAccountRole(str, Enum):
    PORTAL_USER = "portal_user"
    PORTAL_MANAGER = "portal_manager"


class HealthCheckStatus(str, Enum):
    UNKNOWN = "unknown"
    UP = "up"
    DEGRADED = "degraded"
    DOWN = "down"


class HealthWindow(str, Enum):
    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    QUARTER = "quarter"
    HALF_YEAR = "half_year"
    YEAR = "year"


ExternalIdentityProviderType = Literal["oidc", "ldap"]
HealthCheckMode = Literal["http", "s3"]
IdentityProviderSource = Literal["environment", "ui"]
KeyRotationPhase = Literal["prepared", "activated"]
LDAPLinkingPolicy = Literal["manual", "reauthenticate"]
OIDCLinkingPolicy = Literal["manual", "reauthenticate", "trusted_email"]
ReadinessCheckLevel = Literal["blocked", "critical", "warning", "manual", "ok"]
ReadinessCheckResult = Literal["pass", "fail", "manual"]
ReadinessCheckSeverity = Literal["blocker", "critical", "warning"]
ReadinessStatus = Literal["blocked", "critical", "warning", "ok"]
S3SubjectType = Literal["account", "s3_user"]
S3SubjectFilter = Literal["all", "account", "s3_user"]
SortDirection = Literal["asc", "desc"]


ServiceIdentityMode = Literal["managed", "external"]
ServiceIdentityKind = Literal["runtime", "supervision", "ceph_admin"]
ManagedServiceIdentityKind = Literal["runtime", "supervision"]
ServiceIdentityStatus = Literal[
    "not_provisioned",
    "missing",
    "provisioning",
    "ready",
    "error",
    "revocation_pending",
    "disabled",
]

SERVICE_IDENTITY_KINDS: tuple[ServiceIdentityKind, ...] = (
    "runtime",
    "supervision",
    "ceph_admin",
)
MANAGED_SERVICE_IDENTITY_KINDS: tuple[ManagedServiceIdentityKind, ...] = (
    "runtime",
    "supervision",
)
