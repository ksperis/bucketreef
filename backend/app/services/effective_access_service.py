# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Central authorization policy for UI-user storage execution contexts."""

from __future__ import annotations

from app.models.feature_policy import FeaturePolicy, ManagerFeaturePolicies, resolve_feature_policy
from app.services import app_settings_service

from dataclasses import dataclass
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db import S3Account, S3Connection, UiGroup, User
from app.core.domain_enums import ManagerAccountRole, StorageProvider, is_admin_ui_role
from app.models.user import EffectiveUserAccess, LinkedUiGroup, ManagerToolAccess
from app.services.access_context_contracts import BucketMigrationAccessScope, EffectiveAccountLink
from app.services.association_names import load_s3_user_names, load_shared_s3_connection_names
from app.services.effective_access_contracts import EffectiveAccessSource, ResolvedUserAccess
from app.services.effective_access_loader import EffectiveAccessLoader
from app.services.manager_tool_access import MANAGER_TOOL_COLUMNS, MANAGER_TOOL_ROLES
from app.services.mappers.effective_access import effective_user_access_from_resolved
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.time import utcnow


@dataclass(frozen=True)
class _ResolvedFeatureAccess:
    can_access_ceph_admin: bool
    can_access_storage_ops: bool
    can_create_manual_private_connections: bool
    can_provision_managed_private_connections: bool
    allow_multisite_endpoint_switching: bool
    manager_tool_access: ManagerToolAccess
    browser_advanced_features_enabled: bool


class EffectiveAccessService:
    """Single source for role aggregation and executable UI-user contexts."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.loader = EffectiveAccessLoader(db)

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
            "multisite_endpoint_switching": (
                features.allow_multisite_endpoint_switching,
                "allow_multisite_endpoint_switching",
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

        loaded = self.loader.load(list(user_by_id.values()))
        groups = loaded.groups
        account_accumulators = loaded.account_accumulators
        s3_user_grants = loaded.s3_user_grants
        connection_grants = loaded.connection_grants
        owned_private_user_ids = loaded.owned_private_user_ids

        policies = app_settings_service.load_app_settings_for_db(self.db).manager.feature_policies
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
                allow_multisite_endpoint_switching=features.allow_multisite_endpoint_switching,
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
        allow_multisite_endpoint_switching = role_supports_tools and self._user_or_group_flag(
            user,
            groups,
            "allow_multisite_endpoint_switching",
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
            allow_multisite_endpoint_switching=allow_multisite_endpoint_switching,
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
        statement = select(S3Connection).where(
            S3Connection.is_active.is_(True),
            (S3Connection.expires_at.is_(None)) | (S3Connection.expires_at > now),
        )
        if workspace == "browser":
            return self.db.scalars(
                statement.where(
                    S3Connection.is_shared.is_(False),
                    S3Connection.created_by_user_id == user.id,
                    S3Connection.access_browser.is_(True),
                )
            ).all()
        return self.db.scalars(
            statement.where(
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
            )
        ).all()

    def build_bucket_migration_scope(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
        auth_session_id: str | None = None,
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
        if auth_session_id:
            from app.services.openstack_service import OpenStackService
            allowed_context_ids.update(item.id for item in OpenStackService(self.db).catalogue(user, auth_session_id))
        return BucketMigrationAccessScope(
            user=user,
            allowed_context_ids=allowed_context_ids,
            auth_session_id=auth_session_id,
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
        accounts = self.db.scalars(
            select(S3Account)
            .options(joinedload(S3Account.storage_endpoint))
            .where(S3Account.id.in_(account_ids))
        ).all()
        return [account for account in accounts if self.portal_account_is_compatible(account)]

    def list_browser_portal_accounts(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> list[tuple[S3Account, EffectiveAccountLink]]:
        """Return Portal identities explicitly exposed in standalone Browser."""
        from app.services.portal_service import PortalService

        settings = app_settings_service.load_app_settings_for_db(self.db)
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
        return effective_user_access_from_resolved(
            resolved,
            s3_user_names=s3_user_names,
            shared_connection_names=shared_connection_names,
        )
