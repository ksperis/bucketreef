# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Central authorization policy for UI-user storage execution contexts."""

from __future__ import annotations

from app.models.feature_policy import FeaturePolicy, ManagerFeaturePolicies, resolve_feature_policy
from app.services.app_settings_service import load_app_settings_for_db_readonly

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.orm import Session, joinedload

from app.db import (
    ManagerAccountRole,
    S3Account,
    S3Connection,
    S3User,
    StorageProvider,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
    is_admin_ui_role,
)
from app.models.user import (
    EffectiveAccountGroupSource,
    EffectiveAccountMembership,
    EffectiveAccountRoleProvenance,
    EffectiveUserAccess,
    LinkedS3Connection,
    LinkedS3User,
    LinkedUiGroup,
    ManagerToolAccess,
)
from app.models.access_context import BucketMigrationAccessScope, EffectiveAccountGroupRole, EffectiveAccountLink
from app.services.association_names import load_s3_user_names, load_shared_s3_connection_names
from app.services.manager_tool_access import MANAGER_TOOL_COLUMNS, MANAGER_TOOL_ROLES
from app.utils.account_roles import (
    ManagerAccountRoleValue,
    PortalAccountRoleValue,
    max_portal_account_role,
)
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow


@dataclass
class _AccountRoleAccumulator:
    account_id: int
    direct_manager_role: ManagerAccountRoleValue | None = None
    direct_portal_role: PortalAccountRoleValue | None = None
    direct_allow_manager_browser_data_access: bool = False
    group_roles: list[
        tuple[
            int,
            str,
            ManagerAccountRoleValue | None,
            PortalAccountRoleValue | None,
            bool,
        ]
    ] = field(default_factory=list)

    def build(self) -> EffectiveAccountLink:
        manager_role = (
            ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
            if self.direct_manager_role is not None
            or any(source[2] is not None for source in self.group_roles)
            else None
        )
        portal_role = max_portal_account_role(
            self.direct_portal_role,
            *(source[3] for source in self.group_roles),
        )
        if manager_role is None and portal_role is None:
            raise ValueError("Account association has no role")
        return EffectiveAccountLink(
            account_id=self.account_id,
            manager_role=manager_role,
            portal_role=portal_role,
            direct_manager_role=self.direct_manager_role,
            direct_portal_role=self.direct_portal_role,
            direct_determines_effective_manager_role=(
                self.direct_manager_role is not None
                and self.direct_manager_role == manager_role
            ),
            direct_determines_effective_portal_role=(
                self.direct_portal_role is not None
                and self.direct_portal_role == portal_role
            ),
            direct_allow_manager_browser_data_access=(
                self.direct_allow_manager_browser_data_access
            ),
            group_sources=tuple(
                EffectiveAccountGroupRole(
                    group_id=group_id,
                    group_name=group_name,
                    manager_role=group_manager_role,
                    portal_role=group_portal_role,
                    determines_effective_manager_role=(
                        group_manager_role is not None
                        and group_manager_role == manager_role
                    ),
                    determines_effective_portal_role=(
                        group_portal_role is not None
                        and group_portal_role == portal_role
                    ),
                    allow_manager_browser_data_access=allow_manager_browser_data_access,
                )
                for group_id, group_name, group_manager_role, group_portal_role, allow_manager_browser_data_access in sorted(
                    self.group_roles,
                    key=lambda source: (source[1].lower(), source[0]),
                )
            ),
        )


@dataclass(frozen=True)
class _ResolvedFeatureAccess:
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool


@dataclass(frozen=True)
class _GroupMembershipIndex:
    groups_by_user: dict[int, list[UiGroup]]
    user_ids_by_group: dict[int, list[int]]
    group_names: dict[int, str]

    @property
    def group_ids(self) -> list[int]:
        return list(self.group_names)


@dataclass
class _S3UserGrantIndex:
    ids_by_user: dict[int, set[int]]
    browser_ids_by_user: dict[int, set[int]]
    sources_by_user: dict[int, dict[int, list[EffectiveAccessSource]]]
    browser_sources_by_user: dict[int, dict[int, list[EffectiveAccessSource]]]


@dataclass
class _ConnectionGrantIndex:
    ids_by_user: dict[int, set[int]]
    sources_by_user: dict[int, dict[int, list[EffectiveAccessSource]]]


@dataclass(frozen=True)
class EffectiveAccessSource:
    """Origin of an effective UI grant used for read-only access auditing."""

    kind: Literal["direct", "group", "platform"]
    group_id: int | None = None
    group_name: str | None = None


@dataclass
class ResolvedUserAccess:
    group_ids: list[int]
    group_details: list[LinkedUiGroup]
    account_links: list[EffectiveAccountLink]
    s3_user_ids: list[int]
    manager_browser_s3_user_ids: list[int]
    s3_connection_ids: list[int]
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    has_owned_private_connections: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool
    feature_sources: dict[str, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)
    s3_user_sources: dict[int, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)
    s3_user_browser_sources: dict[int, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)
    s3_connection_sources: dict[int, tuple[EffectiveAccessSource, ...]] = field(default_factory=dict)

    @property
    def account_ids(self) -> list[int]:
        return [link.account_id for link in self.account_links]

    def account_link_for(self, account_id: int) -> EffectiveAccountLink | None:
        return next((link for link in self.account_links if link.account_id == account_id), None)

    def has_s3_user(self, s3_user_id: int) -> bool:
        return s3_user_id in set(self.s3_user_ids)

    def can_browse_s3_user(self, s3_user_id: int) -> bool:
        return s3_user_id in set(self.manager_browser_s3_user_ids)


class EffectiveAccessService:
    """Single source for role aggregation and executable UI-user contexts."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve_user(self, user: User) -> ResolvedUserAccess:
        return self.resolve_users([user])[int(user.id)]

    @staticmethod
    def _ordered_sources(
        sources: list[EffectiveAccessSource],
    ) -> tuple[EffectiveAccessSource, ...]:
        deduplicated = {
            (source.kind, source.group_id): source
            for source in sources
        }
        return tuple(
            sorted(
                deduplicated.values(),
                key=lambda source: (
                    0 if source.kind == "direct" else 1,
                    (source.group_name or "").lower(),
                    source.group_id or 0,
                ),
            )
        )

    @classmethod
    def _flag_sources(
        cls,
        user: User,
        groups: list[UiGroup],
        field_name: str,
    ) -> tuple[EffectiveAccessSource, ...]:
        sources: list[EffectiveAccessSource] = []
        if bool(getattr(user, field_name)):
            sources.append(EffectiveAccessSource(kind="direct"))
        sources.extend(
            EffectiveAccessSource(
                kind="group",
                group_id=int(group.id),
                group_name=str(group.name),
            )
            for group in groups
            if bool(getattr(group, field_name))
        )
        return cls._ordered_sources(sources)

    def _load_group_memberships(self, user_ids: list[int]) -> _GroupMembershipIndex:
        groups_by_user: dict[int, list[UiGroup]] = {user_id: [] for user_id in user_ids}
        user_ids_by_group: dict[int, list[int]] = {}
        group_names: dict[int, str] = {}
        rows = (
            self.db.query(UserUiGroup, UiGroup)
            .join(UiGroup, UiGroup.id == UserUiGroup.group_id)
            .filter(UserUiGroup.user_id.in_(user_ids))
            .order_by(UserUiGroup.user_id.asc(), UiGroup.name.asc(), UiGroup.id.asc())
            .all()
        )
        for membership, group in rows:
            user_id = int(membership.user_id)
            group_id = int(group.id)
            groups_by_user[user_id].append(group)
            user_ids_by_group.setdefault(group_id, []).append(user_id)
            group_names[group_id] = str(group.name)
        return _GroupMembershipIndex(
            groups_by_user=groups_by_user,
            user_ids_by_group=user_ids_by_group,
            group_names=group_names,
        )

    def _load_account_roles(
        self,
        user_ids: list[int],
        groups: _GroupMembershipIndex,
    ) -> dict[int, dict[int, _AccountRoleAccumulator]]:
        accumulators: dict[int, dict[int, _AccountRoleAccumulator]] = {
            user_id: {} for user_id in user_ids
        }
        direct_rows = (
            self.db.query(UserS3Account)
            .filter(UserS3Account.user_id.in_(user_ids))
            .all()
        )
        for link in direct_rows:
            user_id = int(link.user_id)
            account_id = int(link.account_id)
            accumulator = accumulators[user_id].setdefault(
                account_id,
                _AccountRoleAccumulator(account_id=account_id),
            )
            accumulator.direct_manager_role = link.manager_role
            accumulator.direct_portal_role = link.portal_role
            accumulator.direct_allow_manager_browser_data_access = bool(
                link.allow_manager_browser_data_access
            )

        if not groups.group_ids:
            return accumulators

        group_rows = (
            self.db.query(UiGroupS3Account)
            .filter(UiGroupS3Account.group_id.in_(groups.group_ids))
            .all()
        )
        for link in group_rows:
            group_id = int(link.group_id)
            for user_id in groups.user_ids_by_group.get(group_id, []):
                account_id = int(link.account_id)
                accumulator = accumulators[user_id].setdefault(
                    account_id,
                    _AccountRoleAccumulator(account_id=account_id),
                )
                accumulator.group_roles.append(
                    (
                        group_id,
                        groups.group_names[group_id],
                        link.manager_role,
                        link.portal_role,
                        bool(link.allow_manager_browser_data_access),
                    )
                )
        return accumulators

    def _load_s3_user_grants(
        self,
        user_ids: list[int],
        groups: _GroupMembershipIndex,
    ) -> _S3UserGrantIndex:
        grants = _S3UserGrantIndex(
            ids_by_user={user_id: set() for user_id in user_ids},
            browser_ids_by_user={user_id: set() for user_id in user_ids},
            sources_by_user={user_id: {} for user_id in user_ids},
            browser_sources_by_user={user_id: {} for user_id in user_ids},
        )
        direct_rows = (
            self.db.query(
                UserS3User.user_id,
                UserS3User.s3_user_id,
                UserS3User.allow_manager_browser_data_access,
            )
            .filter(UserS3User.user_id.in_(user_ids))
            .all()
        )
        for user_id_raw, s3_user_id_raw, browser_allowed in direct_rows:
            user_id = int(user_id_raw)
            s3_user_id = int(s3_user_id_raw)
            source = EffectiveAccessSource(kind="direct")
            grants.ids_by_user[user_id].add(s3_user_id)
            grants.sources_by_user[user_id].setdefault(s3_user_id, []).append(source)
            if bool(browser_allowed):
                grants.browser_ids_by_user[user_id].add(s3_user_id)
                grants.browser_sources_by_user[user_id].setdefault(s3_user_id, []).append(source)

        if not groups.group_ids:
            return grants

        group_rows = (
            self.db.query(
                UiGroupS3User.group_id,
                UiGroupS3User.s3_user_id,
                UiGroupS3User.allow_manager_browser_data_access,
            )
            .filter(UiGroupS3User.group_id.in_(groups.group_ids))
            .all()
        )
        for group_id_raw, s3_user_id_raw, browser_allowed in group_rows:
            group_id = int(group_id_raw)
            s3_user_id = int(s3_user_id_raw)
            source = EffectiveAccessSource(
                kind="group",
                group_id=group_id,
                group_name=groups.group_names[group_id],
            )
            for user_id in groups.user_ids_by_group.get(group_id, []):
                grants.ids_by_user[user_id].add(s3_user_id)
                grants.sources_by_user[user_id].setdefault(s3_user_id, []).append(source)
                if bool(browser_allowed):
                    grants.browser_ids_by_user[user_id].add(s3_user_id)
                    grants.browser_sources_by_user[user_id].setdefault(s3_user_id, []).append(source)
        return grants

    def _load_shared_connection_grants(
        self,
        user_ids: list[int],
        groups: _GroupMembershipIndex,
    ) -> _ConnectionGrantIndex:
        grants = _ConnectionGrantIndex(
            ids_by_user={user_id: set() for user_id in user_ids},
            sources_by_user={user_id: {} for user_id in user_ids},
        )
        direct_rows = (
            self.db.query(UserS3Connection.user_id, UserS3Connection.s3_connection_id)
            .join(S3Connection, S3Connection.id == UserS3Connection.s3_connection_id)
            .filter(
                UserS3Connection.user_id.in_(user_ids),
                S3Connection.is_shared.is_(True),
            )
            .all()
        )
        for user_id_raw, connection_id_raw in direct_rows:
            user_id = int(user_id_raw)
            connection_id = int(connection_id_raw)
            grants.ids_by_user[user_id].add(connection_id)
            grants.sources_by_user[user_id].setdefault(connection_id, []).append(
                EffectiveAccessSource(kind="direct")
            )

        if not groups.group_ids:
            return grants

        group_rows = (
            self.db.query(
                UiGroupS3Connection.group_id,
                UiGroupS3Connection.s3_connection_id,
            )
            .join(S3Connection, S3Connection.id == UiGroupS3Connection.s3_connection_id)
            .filter(
                UiGroupS3Connection.group_id.in_(groups.group_ids),
                S3Connection.is_shared.is_(True),
            )
            .all()
        )
        for group_id_raw, connection_id_raw in group_rows:
            group_id = int(group_id_raw)
            connection_id = int(connection_id_raw)
            source = EffectiveAccessSource(
                kind="group",
                group_id=group_id,
                group_name=groups.group_names[group_id],
            )
            for user_id in groups.user_ids_by_group.get(group_id, []):
                grants.ids_by_user[user_id].add(connection_id)
                grants.sources_by_user[user_id].setdefault(connection_id, []).append(source)
        return grants

    def _load_owned_private_user_ids(self, user_ids: list[int]) -> set[int]:
        return {
            int(row[0])
            for row in self.db.query(S3Connection.created_by_user_id)
            .filter(
                S3Connection.created_by_user_id.in_(user_ids),
                S3Connection.is_shared.is_(False),
            )
            .distinct()
            .all()
        }

    def _build_feature_sources(
        self,
        user: User,
        groups: list[UiGroup],
        features: _ResolvedFeatureAccess,
        policies: ManagerFeaturePolicies,
    ) -> dict[str, tuple[EffectiveAccessSource, ...]]:
        sources: dict[str, tuple[EffectiveAccessSource, ...]] = {}
        feature_fields = {
            "ceph_admin": (features.can_access_ceph_admin, "can_access_ceph_admin"),
            "storage_ops": (features.can_access_storage_ops, "can_access_storage_ops"),
            "private_connection_create": (
                features.can_create_manual_private_connections,
                "can_create_manual_private_connections",
            ),
            "managed_private_connection_provision": (
                features.can_provision_managed_private_connections,
                "can_provision_managed_private_connections",
            ),
            "browser_advanced_features": (
                features.browser_advanced_features_enabled,
                "browser_advanced_features_enabled",
            ),
        }
        for right_code, (enabled, field_name) in feature_fields.items():
            if enabled:
                sources[right_code] = self._flag_sources(user, groups, field_name)
                if (
                    right_code == "managed_private_connection_provision"
                    and policies.managed_private_connection_provisioning
                    == FeaturePolicy.DEFAULT_ON
                ):
                    sources[right_code] = (
                        EffectiveAccessSource(kind="platform"),
                        *sources[right_code],
                    )
        for tool, field_name in MANAGER_TOOL_COLUMNS.items():
            if bool(getattr(features.manager_tool_access, tool)):
                right_code = f"manager_{tool}"
                sources[right_code] = self._flag_sources(user, groups, field_name)
                if getattr(policies, tool) == FeaturePolicy.DEFAULT_ON:
                    sources[right_code] = (
                        EffectiveAccessSource(kind="platform"),
                        *sources[right_code],
                    )
        return sources

    def resolve_users(self, users: list[User]) -> dict[int, ResolvedUserAccess]:
        """Resolve direct and inherited access for many UI users without N+1 queries."""

        user_by_id = {int(user.id): user for user in users}
        user_ids = list(user_by_id)
        if not user_ids:
            return {}

        groups = self._load_group_memberships(user_ids)
        account_accumulators = self._load_account_roles(user_ids, groups)
        s3_user_grants = self._load_s3_user_grants(user_ids, groups)
        connection_grants = self._load_shared_connection_grants(user_ids, groups)
        owned_private_user_ids = self._load_owned_private_user_ids(user_ids)

        policies = load_app_settings_for_db_readonly(self.db).manager.feature_policies
        resolved_by_user: dict[int, ResolvedUserAccess] = {}
        for user_id, user in user_by_id.items():
            user_groups = groups.groups_by_user[user_id]
            features = self._resolve_feature_access(user, user_groups, policies)
            feature_sources = self._build_feature_sources(
                user,
                user_groups,
                features,
                policies,
            )

            account_links = sorted(
                (accumulator.build() for accumulator in account_accumulators[user_id].values()),
                key=lambda link: link.account_id,
            )
            resolved_by_user[user_id] = ResolvedUserAccess(
                group_ids=[int(group.id) for group in user_groups],
                group_details=[LinkedUiGroup(id=group.id, name=group.name) for group in user_groups],
                account_links=account_links,
                s3_user_ids=sorted(s3_user_grants.ids_by_user[user_id]),
                manager_browser_s3_user_ids=sorted(s3_user_grants.browser_ids_by_user[user_id]),
                s3_connection_ids=sorted(connection_grants.ids_by_user[user_id]),
                can_access_ceph_admin=features.can_access_ceph_admin,
                can_access_storage_ops=features.can_access_storage_ops,
                can_create_manual_private_connections=features.can_create_manual_private_connections,
                can_provision_managed_private_connections=features.can_provision_managed_private_connections,
                has_owned_private_connections=user_id in owned_private_user_ids,
                manager_tool_access=features.manager_tool_access,
                browser_advanced_features_enabled=features.browser_advanced_features_enabled,
                feature_sources=feature_sources,
                s3_user_sources={
                    s3_user_id: self._ordered_sources(sources)
                    for s3_user_id, sources in s3_user_grants.sources_by_user[user_id].items()
                },
                s3_user_browser_sources={
                    s3_user_id: self._ordered_sources(sources)
                    for s3_user_id, sources in s3_user_grants.browser_sources_by_user[user_id].items()
                },
                s3_connection_sources={
                    connection_id: self._ordered_sources(sources)
                    for connection_id, sources in connection_grants.sources_by_user[user_id].items()
                },
            )
        return resolved_by_user

    def _resolve_feature_access(
        self,
        user: User,
        groups: list[UiGroup],
        policies: ManagerFeaturePolicies,
    ) -> _ResolvedFeatureAccess:
        role_supports_tools = user.role in MANAGER_TOOL_ROLES
        can_access_ceph_admin = (
            self._user_or_group_flag(user, groups, "can_access_ceph_admin")
        ) and is_admin_ui_role(user.role)
        can_access_storage_ops = (
            self._user_or_group_flag(user, groups, "can_access_storage_ops")
        ) and role_supports_tools
        manager_tool_access = ManagerToolAccess(
            **{
                output_name: role_supports_tools
                and resolve_feature_policy(getattr(policies, output_name),
                    True if self._user_or_group_flag(user, groups, user_field) else None).enabled
                for output_name, user_field in MANAGER_TOOL_COLUMNS.items()
            }
        )
        browser_advanced = self._user_or_group_flag(
            user,
            groups,
            "browser_advanced_features_enabled",
        )
        can_create_manual_private_connections = role_supports_tools and (
            self._user_or_group_flag(
                user,
                groups,
                "can_create_manual_private_connections",
            )
        )
        can_provision_managed_private_connections = role_supports_tools and (
            resolve_feature_policy(
                policies.managed_private_connection_provisioning,
                True if self._user_or_group_flag(user, groups, "can_provision_managed_private_connections") else None,
            ).enabled
        )
        return _ResolvedFeatureAccess(
            can_access_ceph_admin=can_access_ceph_admin,
            can_access_storage_ops=can_access_storage_ops,
            can_create_manual_private_connections=(
                can_create_manual_private_connections
            ),
            can_provision_managed_private_connections=(
                can_provision_managed_private_connections
            ),
            manager_tool_access=manager_tool_access,
            browser_advanced_features_enabled=browser_advanced,
        )

    @staticmethod
    def _user_or_group_flag(
        user: User,
        groups: list[UiGroup],
        field_name: str,
    ) -> bool:
        return bool(getattr(user, field_name)) or any(
            bool(getattr(group, field_name)) for group in groups
        )

    def list_workspace_connections(
        self,
        user: User,
        *,
        workspace: str,
        resolved: ResolvedUserAccess | None = None,
    ) -> list[S3Connection]:
        if workspace not in {"manager", "browser"}:
            raise ValueError("Unsupported workspace")
        effective = resolved or self.resolve_user(user)
        now = utcnow()
        query = self.db.query(S3Connection).filter(
            S3Connection.is_active.is_(True),
            (S3Connection.expires_at.is_(None)) | (S3Connection.expires_at > now),
        )
        if workspace == "browser":
            return query.filter(
                S3Connection.is_shared.is_(False),
                S3Connection.created_by_user_id == user.id,
                S3Connection.access_browser.is_(True),
            ).all()
        return query.filter(
            S3Connection.access_manager.is_(True),
            S3Connection.remediation_required.is_(False),
            (
                (S3Connection.is_shared.is_(False))
                & (S3Connection.created_by_user_id == user.id)
            )
            | (
                (S3Connection.is_shared.is_(True))
                & (S3Connection.id.in_(effective.s3_connection_ids))
            ),
        ).all()

    def build_bucket_migration_scope(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> BucketMigrationAccessScope:
        effective = resolved if resolved is not None else self.resolve_user(user)
        admin_account_context_ids = {
            str(link.account_id)
            for link in effective.account_links
            if self.manager_account_allowed(link)
        }
        allowed_context_ids = admin_account_context_ids | {
            f"s3u-{s3_user_id}" for s3_user_id in effective.s3_user_ids
        }
        allowed_context_ids.update(
            f"conn-{connection.id}"
            for connection in self.list_workspace_connections(user, workspace="manager", resolved=effective)
        )
        return BucketMigrationAccessScope(
            user=user,
            allowed_context_ids=allowed_context_ids,
            admin_account_context_ids=admin_account_context_ids,
        )

    def connection_is_allowed(
        self,
        user: User,
        connection: S3Connection,
        *,
        workspace: str,
        resolved: ResolvedUserAccess | None = None,
    ) -> bool:
        return any(
            candidate.id == connection.id
            for candidate in self.list_workspace_connections(user, workspace=workspace, resolved=resolved)
        )

    def manager_browser_connection_is_allowed(
        self,
        user: User,
        connection: S3Connection,
    ) -> bool:
        now = utcnow()
        return bool(
            not connection.is_shared
            and connection.created_by_user_id == user.id
            and connection.is_active
            and (connection.expires_at is None or connection.expires_at > now)
            and not connection.remediation_required
            and connection.access_manager
            and connection.access_browser
        )

    @staticmethod
    def portal_account_is_compatible(account: S3Account) -> bool:
        endpoint = account.storage_endpoint
        return bool(
            endpoint.provider == StorageProvider.CEPH.value
            and resolve_feature_flags(endpoint).iam_enabled
        )

    def list_portal_accounts(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> list[S3Account]:
        effective = resolved or self.resolve_user(user)
        account_ids = [
            link.account_id
            for link in effective.account_links
            if link.portal_role is not None
        ]
        if not account_ids:
            return []
        accounts = (
            self.db.query(S3Account)
            .options(joinedload(S3Account.storage_endpoint))
            .filter(S3Account.id.in_(account_ids))
            .all()
        )
        return [account for account in accounts if self.portal_account_is_compatible(account)]

    def list_browser_portal_accounts(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> list[tuple[S3Account, EffectiveAccountLink]]:
        """Return Portal identities explicitly exposed in standalone Browser."""
        from app.services.app_settings_service import load_app_settings
        from app.services.portal_service import PortalService

        settings = load_app_settings()
        if not (
            settings.general.browser_enabled
            and settings.general.browser_root_enabled
            and settings.general.portal_enabled
            and settings.general.browser_portal_enabled
        ):
            return []

        effective = resolved or self.resolve_user(user)
        links_by_account_id = {
            link.account_id: link
            for link in effective.account_links
            if link.portal_role is not None
        }
        if not links_by_account_id:
            return []

        portal_service = PortalService(self.db)
        return [
            (account, links_by_account_id[account.id])
            for account in self.list_portal_accounts(user, resolved=effective)
            if account.id in links_by_account_id
            and portal_service.get_effective_portal_settings(
                account,
                base_settings=settings.portal,
            ).browser_access_enabled
        ]

    @staticmethod
    def manager_account_allowed(link: EffectiveAccountLink) -> bool:
        return link.manager_role == ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value

    def to_user_effective_access(self, user: User) -> EffectiveUserAccess:
        resolved = self.resolve_user(user)
        s3_user_names = load_s3_user_names(self.db, resolved.s3_user_ids)
        shared_connection_names = load_shared_s3_connection_names(self.db, resolved.s3_connection_ids)
        return EffectiveUserAccess(
            can_access_ceph_admin=resolved.can_access_ceph_admin,
            can_access_storage_ops=resolved.can_access_storage_ops,
            can_create_manual_private_connections=resolved.can_create_manual_private_connections,
            can_provision_managed_private_connections=resolved.can_provision_managed_private_connections,
            group_can_provision_managed_private_connections=any(
                source.kind == "group"
                for source in resolved.feature_sources.get(
                    "managed_private_connection_provision",
                    (),
                )
            ),
            has_owned_private_connections=resolved.has_owned_private_connections,
            manager_tool_access=resolved.manager_tool_access,
            group_manager_tool_access=ManagerToolAccess(
                **{
                    tool: any(
                        source.kind == "group"
                        for source in resolved.feature_sources.get(
                            f"manager_{tool}",
                            (),
                        )
                    )
                    for tool in MANAGER_TOOL_COLUMNS
                }
            ),
            browser_advanced_features_enabled=resolved.browser_advanced_features_enabled,
            account_links=[
                EffectiveAccountMembership(
                    account_id=link.account_id,
                    manager_role=link.manager_role,
                    portal_role=link.portal_role,
                    allow_manager_browser_data_access=link.manager_browser_allowed,
                    provenance=EffectiveAccountRoleProvenance(
                        direct_manager_role=link.direct_manager_role,
                        direct_portal_role=link.direct_portal_role,
                        direct_determines_effective_manager_role=(
                            link.direct_determines_effective_manager_role
                        ),
                        direct_determines_effective_portal_role=(
                            link.direct_determines_effective_portal_role
                        ),
                        direct_allow_manager_browser_data_access=(
                            link.direct_allow_manager_browser_data_access
                        ),
                        groups=[
                            EffectiveAccountGroupSource(
                                group_id=source.group_id,
                                group_name=source.group_name,
                                manager_role=source.manager_role,
                                portal_role=source.portal_role,
                                determines_effective_manager_role=(
                                    source.determines_effective_manager_role
                                ),
                                determines_effective_portal_role=(
                                    source.determines_effective_portal_role
                                ),
                                allow_manager_browser_data_access=(
                                    source.allow_manager_browser_data_access
                                ),
                            )
                            for source in link.group_sources
                        ],
                    ),
                )
                for link in resolved.account_links
            ],
            s3_user_details=[
                LinkedS3User(id=s3_id, name=s3_user_names.get(s3_id) or f"S3 User #{s3_id}")
                for s3_id in resolved.s3_user_ids
            ],
            s3_connection_details=[
                LinkedS3Connection(
                    id=conn_id,
                    name=(details if details else f"Connection #{conn_id}"),
                )
                for conn_id in resolved.s3_connection_ids
                for details in [shared_connection_names.get(conn_id)]
            ],
        )
