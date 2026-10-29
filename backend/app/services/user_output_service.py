# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import (
    S3Connection,
    UiGroup,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
    is_admin_ui_role,
)
from app.db.openstack import OpenStackCloud, cloud_users
from app.models.openstack import LinkedOpenStackCloud
from app.models.user import (
    AccountMembership,
    LinkedS3Connection,
    LinkedS3User,
    LinkedUiGroup,
    S3UserMembership,
    UiPreferences,
    UserOut,
)
from app.services.association_names import load_s3_user_names
from app.services.effective_access_service import EffectiveAccessService
from app.services.manager_tool_access import read_manager_tool_access
from app.services.user_avatar_service import UserAvatarService


@dataclass(frozen=True)
class UserOutputPreload:
    account_links_by_user: dict[int, list[AccountMembership]]
    group_ids_by_user: dict[int, list[int]]
    group_names: dict[int, str]
    s3_user_links_by_user: dict[int, list[S3UserMembership]]
    s3_user_names: dict[int, str]
    connection_ids_by_user: dict[int, list[int]]
    connection_names: dict[int, str]
    openstack_cloud_ids_by_user: dict[int, list[int]]
    openstack_cloud_names: dict[int, str]


class UserOutputService:
    """Build the complete public user projection from direct and effective access."""

    def __init__(self, db: Session) -> None:
        self.db = db

    @staticmethod
    def _empty_preload(user_ids: list[int]) -> UserOutputPreload:
        return UserOutputPreload(
            account_links_by_user={user_id: [] for user_id in user_ids},
            group_ids_by_user={user_id: [] for user_id in user_ids},
            group_names={},
            s3_user_links_by_user={user_id: [] for user_id in user_ids},
            s3_user_names={},
            connection_ids_by_user={user_id: [] for user_id in user_ids},
            connection_names={},
            openstack_cloud_ids_by_user={user_id: [] for user_id in user_ids},
            openstack_cloud_names={},
        )

    def _load_account_links(
        self,
        user_ids: list[int],
    ) -> dict[int, list[AccountMembership]]:
        links_by_user: dict[int, list[AccountMembership]] = {
            user_id: [] for user_id in user_ids
        }
        account_rows = self.db.scalars(
            select(UserS3Account)
            .where(UserS3Account.user_id.in_(user_ids))
            .order_by(UserS3Account.id.asc())
        ).all()
        for link in account_rows:
            links_by_user[int(link.user_id)].append(
                AccountMembership(
                    account_id=link.account_id,
                    manager_role=link.manager_role,
                    portal_role=link.portal_role,
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                )
            )
        return links_by_user

    def _load_group_links(
        self,
        user_ids: list[int],
    ) -> tuple[dict[int, list[int]], dict[int, str]]:
        ids_by_user = {user_id: [] for user_id in user_ids}
        group_rows = self.db.execute(
            select(UserUiGroup, UiGroup.name)
            .join(UiGroup, UiGroup.id == UserUiGroup.group_id)
            .where(UserUiGroup.user_id.in_(user_ids))
            .order_by(UserUiGroup.id.asc())
        ).all()
        group_names: dict[int, str] = {}
        for link, group_name in group_rows:
            group_id = int(link.group_id)
            ids_by_user[int(link.user_id)].append(group_id)
            group_names[group_id] = group_name
        return ids_by_user, group_names

    def _load_s3_user_links(
        self,
        user_ids: list[int],
    ) -> tuple[dict[int, list[S3UserMembership]], set[int]]:
        links_by_user: dict[int, list[S3UserMembership]] = {
            user_id: [] for user_id in user_ids
        }
        s3_user_rows = self.db.scalars(
            select(UserS3User)
            .where(UserS3User.user_id.in_(user_ids))
            .order_by(UserS3User.id.asc())
        ).all()
        s3_user_ids: set[int] = set()
        for link in s3_user_rows:
            s3_user_id = int(link.s3_user_id)
            s3_user_ids.add(s3_user_id)
            links_by_user[int(link.user_id)].append(
                S3UserMembership(
                    s3_user_id=s3_user_id,
                    allow_manager_browser_data_access=bool(
                        link.allow_manager_browser_data_access
                    ),
                )
            )
        return links_by_user, s3_user_ids

    def _load_connection_links(
        self,
        user_ids: list[int],
    ) -> tuple[dict[int, list[int]], dict[int, str]]:
        ids_by_user = {user_id: [] for user_id in user_ids}
        connection_rows = self.db.execute(
            select(UserS3Connection, S3Connection.name)
            .join(
                S3Connection,
                S3Connection.id == UserS3Connection.s3_connection_id,
            )
            .where(
                UserS3Connection.user_id.in_(user_ids),
                S3Connection.is_shared.is_(True),
            )
            .order_by(UserS3Connection.id.asc())
        ).all()
        connection_names: dict[int, str] = {}
        for link, connection_name in connection_rows:
            connection_id = int(link.s3_connection_id)
            ids_by_user[int(link.user_id)].append(connection_id)
            connection_names[connection_id] = connection_name
        return ids_by_user, connection_names

    def _load_openstack_cloud_links(
        self,
        user_ids: list[int],
    ) -> tuple[dict[int, list[int]], dict[int, str]]:
        ids_by_user = {user_id: [] for user_id in user_ids}
        rows = self.db.execute(
            select(
                cloud_users.c.user_id,
                OpenStackCloud.id,
                OpenStackCloud.name,
            )
            .join(OpenStackCloud, OpenStackCloud.id == cloud_users.c.cloud_id)
            .where(cloud_users.c.user_id.in_(user_ids))
            .order_by(OpenStackCloud.name.asc(), OpenStackCloud.id.asc())
        ).all()
        names: dict[int, str] = {}
        for user_id_raw, cloud_id_raw, cloud_name in rows:
            user_id = int(user_id_raw)
            cloud_id = int(cloud_id_raw)
            ids_by_user[user_id].append(cloud_id)
            names[cloud_id] = str(cloud_name)
        return ids_by_user, names

    def preload(self, users: list[User]) -> UserOutputPreload:
        user_ids = [int(user.id) for user in users]
        if not user_ids:
            return self._empty_preload(user_ids)

        account_links_by_user = self._load_account_links(user_ids)
        group_ids_by_user, group_names = self._load_group_links(user_ids)
        s3_user_links_by_user, s3_user_ids = self._load_s3_user_links(user_ids)
        connection_ids_by_user, connection_names = self._load_connection_links(user_ids)
        openstack_cloud_ids_by_user, openstack_cloud_names = self._load_openstack_cloud_links(user_ids)

        return UserOutputPreload(
            account_links_by_user=account_links_by_user,
            group_ids_by_user=group_ids_by_user,
            group_names=group_names,
            s3_user_links_by_user=s3_user_links_by_user,
            s3_user_names=load_s3_user_names(self.db, sorted(s3_user_ids)),
            connection_ids_by_user=connection_ids_by_user,
            connection_names=connection_names,
            openstack_cloud_ids_by_user=openstack_cloud_ids_by_user,
            openstack_cloud_names=openstack_cloud_names,
        )

    @staticmethod
    def _s3_user_details(
        links: list[S3UserMembership],
        names: dict[int, str],
    ) -> list[LinkedS3User]:
        return [
            LinkedS3User(
                id=link.s3_user_id,
                name=names.get(link.s3_user_id) or f"S3 User #{link.s3_user_id}",
            )
            for link in links
        ]

    @staticmethod
    def _connection_details(
        connection_ids: list[int],
        names: dict[int, str],
    ) -> list[LinkedS3Connection]:
        return [
            LinkedS3Connection(id=connection_id, name=names[connection_id])
            for connection_id in connection_ids
            if connection_id in names
        ]

    @staticmethod
    def _openstack_cloud_details(
        cloud_ids: list[int],
        names: dict[int, str],
    ) -> list[LinkedOpenStackCloud]:
        return [
            LinkedOpenStackCloud(id=cloud_id, name=names[cloud_id])
            for cloud_id in cloud_ids
            if cloud_id in names
        ]

    @staticmethod
    def _group_details(
        group_ids: list[int],
        names: dict[int, str],
    ) -> list[LinkedUiGroup]:
        return [
            LinkedUiGroup(
                id=group_id,
                name=names.get(group_id) or f"Group #{group_id}",
            )
            for group_id in group_ids
        ]

    def to_out(
        self,
        user: User,
        *,
        preloaded: UserOutputPreload | None = None,
    ) -> UserOut:
        projection = preloaded or self.preload([user])
        user_id = int(user.id)
        account_links = projection.account_links_by_user.get(user_id, [])
        group_ids = projection.group_ids_by_user.get(user_id, [])
        s3_user_links = projection.s3_user_links_by_user.get(user_id, [])
        s3_connection_ids = projection.connection_ids_by_user.get(user_id, [])
        openstack_cloud_ids = projection.openstack_cloud_ids_by_user.get(user_id, [])

        return UserOut(
            id=user.id,
            email=user.email,
            full_name=user.full_name,
            picture_url=user.picture_url,
            avatar=UserAvatarService(self.db).descriptor(user),
            has_local_password=bool(user.hashed_password),
            is_active=user.is_active,
            is_admin=is_admin_ui_role(user.role),
            role=user.role,
            can_access_ceph_admin=bool(user.can_access_ceph_admin),
            can_access_storage_ops=bool(user.can_access_storage_ops),
            can_create_manual_private_connections=bool(
                user.can_create_manual_private_connections
            ),
            can_provision_managed_private_connections=bool(
                user.can_provision_managed_private_connections
            ),
            manager_tool_access=read_manager_tool_access(user),
            browser_advanced_features_enabled=bool(
                user.browser_advanced_features_enabled
            ),
            ui_language=user.ui_language,
            quota_alerts_enabled=bool(user.quota_alerts_enabled),
            quota_alerts_global_watch=bool(user.quota_alerts_global_watch),
            ui_preferences=UiPreferences.model_validate_json(
                user.ui_preferences_json
            ),
            account_links=account_links,
            group_details=self._group_details(group_ids, projection.group_names),
            s3_user_links=s3_user_links,
            s3_user_details=self._s3_user_details(s3_user_links, projection.s3_user_names),
            s3_connection_details=self._connection_details(
                s3_connection_ids,
                projection.connection_names,
            ),
            openstack_cloud_details=self._openstack_cloud_details(
                openstack_cloud_ids,
                projection.openstack_cloud_names,
            ),
            effective_access=EffectiveAccessService(
                self.db
            ).to_user_effective_access(user),
            last_login_at=user.last_login_at,
        )
