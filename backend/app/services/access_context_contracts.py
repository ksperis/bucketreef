# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Internal access and session execution contracts."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.db import S3Account, User, UserS3Account
from app.core.domain_enums import ManagerAccountRole, UserRole
from app.models.session import SessionCapabilities
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue


@dataclass
class AccountCapabilities:
    can_manage_buckets: bool = False
    can_manage_portal_users: bool = False
    can_manage_iam: bool = False
    can_view_root_key: bool = False
    using_root_key: bool = False


@dataclass
class ManagerSessionPrincipal:
    session_id: str
    access_key: str
    secret_key: str
    actor_type: str
    account_id: str | None
    account_name: str | None
    user_uid: str | None
    capabilities: SessionCapabilities
    role: str = UserRole.UI_USER.value
    email: str = "s3-session@local"
    id: int | None = None


ManagerActor = User | ManagerSessionPrincipal


@dataclass(frozen=True)
class EffectiveAccountGroupRole:
    group_id: int
    group_name: str
    manager_role: ManagerAccountRoleValue | None = None
    portal_role: PortalAccountRoleValue | None = None
    determines_effective_manager_role: bool = False
    determines_effective_portal_role: bool = False
    allow_manager_browser_data_access: bool = False


@dataclass(frozen=True)
class EffectiveAccountLink:
    account_id: int
    manager_role: ManagerAccountRoleValue | None = None
    portal_role: PortalAccountRoleValue | None = None
    direct_manager_role: ManagerAccountRoleValue | None = None
    direct_portal_role: PortalAccountRoleValue | None = None
    direct_determines_effective_manager_role: bool = False
    direct_determines_effective_portal_role: bool = False
    direct_allow_manager_browser_data_access: bool = False
    group_sources: tuple[EffectiveAccountGroupRole, ...] = ()

    @property
    def manager_browser_allowed(self) -> bool:
        admin_role = ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
        return bool(
            self.direct_manager_role == admin_role
            and self.direct_allow_manager_browser_data_access
        ) or any(
            source.manager_role == admin_role
            and source.allow_manager_browser_data_access
            for source in self.group_sources
        )


@dataclass
class AccountAccess:
    """Resolved Portal access for one account and one UI user."""

    account: S3Account
    actor: User
    membership: UserS3Account | EffectiveAccountLink | None
    capabilities: AccountCapabilities
    portal_role: PortalAccountRoleValue


@dataclass
class BucketMigrationAccessScope:
    user: User
    allowed_context_ids: set[str]
    auth_session_id: str | None = None
    admin_account_context_ids: set[str] = field(default_factory=set)
