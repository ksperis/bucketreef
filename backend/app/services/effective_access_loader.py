# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Database loader for effective-access resolution."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import (
    S3Connection,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.core.domain_enums import ManagerAccountRole
from app.db.ui_group import ALL_USERS_SYSTEM_KEY
from app.services.access_context_contracts import EffectiveAccountGroupRole, EffectiveAccountLink
from app.services.effective_access_contracts import EffectiveAccessSource
from app.utils.account_roles import (
    ManagerAccountRoleValue,
    PortalAccountRoleValue,
    max_portal_account_role,
)


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
                for (
                    group_id,
                    group_name,
                    group_manager_role,
                    group_portal_role,
                    allow_manager_browser_data_access,
                ) in sorted(
                    self.group_roles,
                    key=lambda source: (source[1].lower(), source[0]),
                )
            ),
        )


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
class LoadedEffectiveAccess:
    groups: _GroupMembershipIndex
    account_accumulators: dict[int, dict[int, _AccountRoleAccumulator]]
    s3_user_grants: _S3UserGrantIndex
    connection_grants: _ConnectionGrantIndex
    owned_private_user_ids: set[int]


class EffectiveAccessLoader:
    """Load persisted grants needed by effective-access policy resolution."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def load(self, users: list[User]) -> LoadedEffectiveAccess:
        user_ids = [int(user.id) for user in users]
        groups = self._load_group_memberships(users)
        return LoadedEffectiveAccess(
            groups=groups,
            account_accumulators=self._load_account_roles(user_ids, groups),
            s3_user_grants=self._load_s3_user_grants(user_ids, groups),
            connection_grants=self._load_shared_connection_grants(user_ids, groups),
            owned_private_user_ids=self._load_owned_private_user_ids(user_ids),
        )

    def _load_group_memberships(self, users: list[User]) -> _GroupMembershipIndex:
        user_ids = [int(user.id) for user in users]
        groups_by_user: dict[int, list[UiGroup]] = {user_id: [] for user_id in user_ids}
        user_ids_by_group: dict[int, list[int]] = {}
        group_names: dict[int, str] = {}
        rows = self.db.execute(
            select(UserUiGroup, UiGroup)
            .join(UiGroup, UiGroup.id == UserUiGroup.group_id)
            .where(UserUiGroup.user_id.in_(user_ids))
            .order_by(UserUiGroup.user_id.asc(), UiGroup.name.asc(), UiGroup.id.asc())
        ).all()
        for membership, group in rows:
            user_id = int(membership.user_id)
            group_id = int(group.id)
            groups_by_user[user_id].append(group)
            user_ids_by_group.setdefault(group_id, []).append(user_id)
            group_names[group_id] = str(group.name)

        all_users_group = self.db.scalar(
            select(UiGroup).where(UiGroup.system_key == ALL_USERS_SYSTEM_KEY).limit(1)
        )
        if all_users_group is not None:
            group_id = int(all_users_group.id)
            eligible_user_ids = [
                int(user.id)
                for user in users
                if user.is_active
                and user.role in {"ui_user", "ui_admin", "ui_superadmin"}
            ]
            for user_id in eligible_user_ids:
                if all(int(group.id) != group_id for group in groups_by_user[user_id]):
                    groups_by_user[user_id].append(all_users_group)
            if eligible_user_ids:
                user_ids_by_group[group_id] = eligible_user_ids
                group_names[group_id] = str(all_users_group.name)
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
        direct_rows = self.db.scalars(
            select(UserS3Account).where(UserS3Account.user_id.in_(user_ids))
        ).all()
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

        group_rows = self.db.scalars(
            select(UiGroupS3Account).where(
                UiGroupS3Account.group_id.in_(groups.group_ids)
            )
        ).all()
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
        direct_rows = self.db.execute(
            select(
                UserS3User.user_id,
                UserS3User.s3_user_id,
                UserS3User.allow_manager_browser_data_access,
            ).where(UserS3User.user_id.in_(user_ids))
        ).all()
        for user_id_raw, s3_user_id_raw, browser_allowed in direct_rows:
            user_id = int(user_id_raw)
            s3_user_id = int(s3_user_id_raw)
            source = EffectiveAccessSource(kind="direct")
            grants.ids_by_user[user_id].add(s3_user_id)
            grants.sources_by_user[user_id].setdefault(s3_user_id, []).append(source)
            if bool(browser_allowed):
                grants.browser_ids_by_user[user_id].add(s3_user_id)
                grants.browser_sources_by_user[user_id].setdefault(
                    s3_user_id, []
                ).append(source)

        if not groups.group_ids:
            return grants

        group_rows = self.db.execute(
            select(
                UiGroupS3User.group_id,
                UiGroupS3User.s3_user_id,
                UiGroupS3User.allow_manager_browser_data_access,
            ).where(UiGroupS3User.group_id.in_(groups.group_ids))
        ).all()
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
                grants.sources_by_user[user_id].setdefault(s3_user_id, []).append(
                    source
                )
                if bool(browser_allowed):
                    grants.browser_ids_by_user[user_id].add(s3_user_id)
                    grants.browser_sources_by_user[user_id].setdefault(
                        s3_user_id, []
                    ).append(source)
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
        direct_rows = self.db.execute(
            select(UserS3Connection.user_id, UserS3Connection.s3_connection_id)
            .join(
                S3Connection,
                S3Connection.id == UserS3Connection.s3_connection_id,
            )
            .where(
                UserS3Connection.user_id.in_(user_ids),
                S3Connection.is_shared.is_(True),
            )
        ).all()
        for user_id_raw, connection_id_raw in direct_rows:
            user_id = int(user_id_raw)
            connection_id = int(connection_id_raw)
            grants.ids_by_user[user_id].add(connection_id)
            grants.sources_by_user[user_id].setdefault(connection_id, []).append(
                EffectiveAccessSource(kind="direct")
            )

        if not groups.group_ids:
            return grants

        group_rows = self.db.execute(
            select(
                UiGroupS3Connection.group_id,
                UiGroupS3Connection.s3_connection_id,
            )
            .join(
                S3Connection,
                S3Connection.id == UiGroupS3Connection.s3_connection_id,
            )
            .where(
                UiGroupS3Connection.group_id.in_(groups.group_ids),
                S3Connection.is_shared.is_(True),
            )
        ).all()
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
                grants.sources_by_user[user_id].setdefault(
                    connection_id, []
                ).append(source)
        return grants

    def _load_owned_private_user_ids(self, user_ids: list[int]) -> set[int]:
        return {
            int(user_id)
            for user_id in self.db.scalars(
                select(S3Connection.created_by_user_id)
                .where(
                    S3Connection.created_by_user_id.in_(user_ids),
                    S3Connection.is_shared.is_(False),
                )
                .distinct()
            ).all()
        }
