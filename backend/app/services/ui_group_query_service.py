# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.db import (
    S3Account,
    S3Connection,
    S3User,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserUiGroup,
)
from app.db.openstack import OpenStackCloud, cloud_groups
from app.models.admin_listing import AdminOptionListingRequest
from app.models.openstack import LinkedOpenStackCloud
from app.models.ui_group import (
    LinkedS3Account,
    PaginatedUiGroupSummariesResponse,
    PaginatedUiGroupsResponse,
    UiGroupListingRequest,
    UiGroupOut,
    UiGroupSummary,
)
from app.models.user import (
    AccountMembership,
    LinkedS3Connection,
    LinkedS3User,
    S3UserMembership,
    UserSummary,
)
from app.services.association_names import (
    load_s3_user_names,
    load_shared_s3_connection_names,
)
from app.services.manager_tool_access import read_manager_tool_access
from app.services.sqlalchemy_pagination import paginate_scalars
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.name_ordering import name_order_by


@dataclass(frozen=True)
class _UiGroupOutputPreload:
    users: list[User]
    account_links: list[UiGroupS3Account]
    s3_user_links: list[UiGroupS3User]
    s3_connection_ids: list[int]
    openstack_cloud_ids: list[int]
    account_names: dict[int, tuple[str, str]]
    s3_user_names: dict[int, str]
    s3_connection_names: dict[int, str]
    openstack_cloud_names: dict[int, str]


class UiGroupQueryService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_group(self, group_id: int) -> Optional[UiGroup]:
        return self.db.get(UiGroup, group_id)

    def list_group_options_page(
        self,
        request: AdminOptionListingRequest,
    ) -> PaginatedUiGroupSummariesResponse:
        search_value = request.search.strip() if isinstance(request.search, str) else ""
        statement = select(UiGroup)
        if search_value:
            statement = statement.where(UiGroup.name.ilike(f"%{search_value}%"))
        rows, total = paginate_scalars(
            self.db,
            statement,
            order_by=name_order_by(UiGroup),
            page=request.page,
            page_size=request.page_size,
        )
        avatar_service = UiGroupAvatarService(self.db)
        items = [
            UiGroupSummary(
                id=row.id,
                name=row.name,
                system_key=row.system_key,
                avatar=avatar_service.descriptor(row),
            )
            for row in rows
        ]
        return PaginatedUiGroupSummariesResponse(
            items=items,
            total=total,
            page=request.page,
            page_size=request.page_size,
            has_next=request.page * request.page_size < total,
        )

    @staticmethod
    def _apply_group_search(statement, search_value: str):
        if not search_value:
            return statement
        member = aliased(User)
        account = aliased(S3Account)
        s3_user = aliased(S3User)
        connection = aliased(S3Connection)
        openstack_cloud = aliased(OpenStackCloud)
        pattern = f"%{search_value}%"
        return (
            statement.outerjoin(UserUiGroup, UiGroup.id == UserUiGroup.group_id)
            .outerjoin(member, UserUiGroup.user_id == member.id)
            .outerjoin(UiGroupS3Account, UiGroup.id == UiGroupS3Account.group_id)
            .outerjoin(account, UiGroupS3Account.account_id == account.id)
            .outerjoin(UiGroupS3User, UiGroup.id == UiGroupS3User.group_id)
            .outerjoin(s3_user, UiGroupS3User.s3_user_id == s3_user.id)
            .outerjoin(
                UiGroupS3Connection,
                UiGroup.id == UiGroupS3Connection.group_id,
            )
            .outerjoin(
                connection,
                and_(
                    UiGroupS3Connection.s3_connection_id == connection.id,
                    connection.is_shared.is_(True),
                ),
            )
            .outerjoin(cloud_groups, UiGroup.id == cloud_groups.c.group_id)
            .outerjoin(
                openstack_cloud,
                cloud_groups.c.cloud_id == openstack_cloud.id,
            )
            .where(
                or_(
                    UiGroup.name.ilike(pattern),
                    func.coalesce(UiGroup.description, "").ilike(pattern),
                    func.coalesce(member.email, "").ilike(pattern),
                    func.coalesce(account.name, "").ilike(pattern),
                    func.coalesce(account.rgw_account_id, "").ilike(pattern),
                    func.coalesce(s3_user.name, "").ilike(pattern),
                    func.coalesce(s3_user.rgw_user_uid, "").ilike(pattern),
                    func.coalesce(connection.name, "").ilike(pattern),
                    func.coalesce(openstack_cloud.name, "").ilike(pattern),
                )
            )
            .distinct()
        )

    @staticmethod
    def _group_order_columns(request: UiGroupListingRequest):
        descending = request.sort_dir == "desc"
        if request.sort_by == "name":
            return name_order_by(UiGroup, descending=descending)
        sort_column = (
            UiGroup.created_at
            if request.sort_by == "created_at"
            else UiGroup.updated_at
        )
        direction = sort_column.desc if descending else sort_column.asc
        id_direction = UiGroup.id.desc if descending else UiGroup.id.asc
        return direction(), id_direction()

    def list_groups_page(
        self,
        request: UiGroupListingRequest,
    ) -> PaginatedUiGroupsResponse:
        search_value = request.search.strip() if isinstance(request.search, str) else ""
        statement = self._apply_group_search(select(UiGroup), search_value)
        rows, total = paginate_scalars(
            self.db,
            statement,
            order_by=self._group_order_columns(request),
            page=request.page,
            page_size=request.page_size,
        )
        return PaginatedUiGroupsResponse(
            items=[self.group_to_out(group) for group in rows],
            total=total,
            page=request.page,
            page_size=request.page_size,
            has_next=request.page * request.page_size < total,
        )

    def _preload_group_output(self, group_id: int) -> _UiGroupOutputPreload:
        user_rows = self.db.scalars(
            select(User)
            .join(UserUiGroup, UserUiGroup.user_id == User.id)
            .where(UserUiGroup.group_id == group_id)
            .order_by(User.email.asc())
        ).all()
        account_rows = self.db.scalars(
            select(UiGroupS3Account)
            .where(UiGroupS3Account.group_id == group_id)
            .order_by(UiGroupS3Account.account_id.asc())
        ).all()
        s3_user_rows = self.db.scalars(
            select(UiGroupS3User).where(UiGroupS3User.group_id == group_id)
        ).all()
        s3_connection_ids = self.db.scalars(
            select(UiGroupS3Connection.s3_connection_id)
            .join(
                S3Connection,
                S3Connection.id == UiGroupS3Connection.s3_connection_id,
            )
            .where(
                UiGroupS3Connection.group_id == group_id,
                S3Connection.is_shared.is_(True),
            )
        ).all()
        openstack_rows = self.db.execute(
            select(OpenStackCloud.id, OpenStackCloud.name)
            .join(cloud_groups, cloud_groups.c.cloud_id == OpenStackCloud.id)
            .where(cloud_groups.c.group_id == group_id)
            .order_by(OpenStackCloud.name.asc(), OpenStackCloud.id.asc())
        ).all()
        s3_user_ids = sorted(row.s3_user_id for row in s3_user_rows)
        s3_connection_ids = sorted(s3_connection_ids)
        openstack_cloud_ids = [
            int(cloud_id)
            for cloud_id, _ in openstack_rows
        ]
        account_ids = sorted(link.account_id for link in account_rows)
        return _UiGroupOutputPreload(
            users=user_rows,
            account_links=account_rows,
            s3_user_links=s3_user_rows,
            s3_connection_ids=s3_connection_ids,
            openstack_cloud_ids=openstack_cloud_ids,
            account_names=self._load_account_names(account_ids),
            s3_user_names=load_s3_user_names(self.db, s3_user_ids),
            s3_connection_names=load_shared_s3_connection_names(
                self.db,
                s3_connection_ids,
            ),
            openstack_cloud_names={
                int(cloud_id): str(cloud_name)
                for cloud_id, cloud_name in openstack_rows
            },
        )

    def _group_user_details(self, users: list[User]) -> list[UserSummary]:
        avatar_service = UserAvatarService(self.db)
        return [
            UserSummary(
                id=user.id,
                email=user.email,
                full_name=user.full_name,
                avatar=avatar_service.descriptor(user),
                role=user.role,
            )
            for user in users
        ]

    @staticmethod
    def _group_account_details(
        links: list[UiGroupS3Account],
        names: dict[int, tuple[str, str]],
    ) -> list[LinkedS3Account]:
        return [
            LinkedS3Account(
                id=link.account_id,
                name=names[link.account_id][0],
                rgw_account_id=names[link.account_id][1],
            )
            for link in links
        ]

    @staticmethod
    def _group_account_links(
        links: list[UiGroupS3Account],
    ) -> list[AccountMembership]:
        return [
            AccountMembership(
                account_id=link.account_id,
                manager_role=link.manager_role,
                portal_role=link.portal_role,
                allow_manager_browser_data_access=link.allow_manager_browser_data_access,
            )
            for link in links
        ]

    @staticmethod
    def _group_s3_user_links(
        links: list[UiGroupS3User],
    ) -> list[S3UserMembership]:
        return [
            S3UserMembership(
                s3_user_id=link.s3_user_id,
                allow_manager_browser_data_access=link.allow_manager_browser_data_access,
            )
            for link in links
        ]

    @staticmethod
    def _group_s3_user_details(
        links: list[UiGroupS3User],
        names: dict[int, str],
    ) -> list[LinkedS3User]:
        ids = sorted(link.s3_user_id for link in links)
        return [
            LinkedS3User(
                id=s3_id,
                name=names.get(s3_id) or f"S3 User #{s3_id}",
            )
            for s3_id in ids
        ]

    @staticmethod
    def _group_s3_connection_details(
        connection_ids: list[int],
        names: dict[int, str],
    ) -> list[LinkedS3Connection]:
        return [
            LinkedS3Connection(
                id=connection_id,
                name=names.get(connection_id) or f"Connection #{connection_id}",
            )
            for connection_id in connection_ids
        ]

    def group_to_out(self, group: UiGroup) -> UiGroupOut:
        preload = self._preload_group_output(int(group.id))
        return UiGroupOut(
            id=group.id,
            name=group.name,
            system_key=group.system_key,
            description=group.description,
            avatar=UiGroupAvatarService(self.db).descriptor(group),
            can_access_ceph_admin=group.can_access_ceph_admin,
            can_access_storage_ops=group.can_access_storage_ops,
            can_create_manual_private_connections=group.can_create_manual_private_connections,
            can_provision_managed_private_connections=group.can_provision_managed_private_connections,
            allow_multisite_endpoint_switching=group.allow_multisite_endpoint_switching,
            manager_tool_access=read_manager_tool_access(group),
            browser_advanced_features_enabled=group.browser_advanced_features_enabled,
            user_details=self._group_user_details(preload.users),
            account_details=self._group_account_details(
                preload.account_links,
                preload.account_names,
            ),
            account_links=self._group_account_links(preload.account_links),
            s3_user_links=self._group_s3_user_links(preload.s3_user_links),
            s3_user_details=self._group_s3_user_details(
                preload.s3_user_links,
                preload.s3_user_names,
            ),
            s3_connection_details=self._group_s3_connection_details(
                preload.s3_connection_ids,
                preload.s3_connection_names,
            ),
            openstack_cloud_details=[
                LinkedOpenStackCloud(
                    id=cloud_id,
                    name=preload.openstack_cloud_names[cloud_id],
                )
                for cloud_id in preload.openstack_cloud_ids
            ],
            created_at=group.created_at,
            updated_at=group.updated_at,
        )

    def _load_account_names(
        self,
        ids: list[int],
    ) -> dict[int, tuple[str, str]]:
        if not ids:
            return {}
        rows = self.db.execute(
            select(
                S3Account.id,
                S3Account.name,
                S3Account.rgw_account_id,
            ).where(S3Account.id.in_(ids))
        ).all()
        return {row[0]: (row[1], row[2]) for row in rows}
