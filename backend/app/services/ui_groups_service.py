# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.domain_errors import UiGroupNotFoundError
from app.db import (
    S3Account,
    S3User,
    UiGroup,
    UiGroupS3Account,
    UiGroupS3Connection,
    UiGroupS3User,
    User,
    UserUiGroup,
)
from app.db.openstack import OpenStackCloud, cloud_groups
from app.db.ui_group import ALL_USERS_SYSTEM_KEY
from app.models.ui_group import (
    PaginatedUiGroupsResponse,
    UiGroupCreate,
    UiGroupListingRequest,
    UiGroupOut,
    UiGroupSummary,
    UiGroupUpdate,
)
from app.models.user import (
    AccountMembership,
    S3UserMembership,
)
from app.services.association_sync import (
    sync_metadata_association_links,
    sync_simple_association_links,
    sync_table_association_links,
    update_account_access_link,
)
from app.services.association_validation import ensure_association_ids_exist, ensure_shared_s3_connections
from app.services.manager_tool_access import manager_tool_column_values
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    commit_portal_role_changes,
)
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.ui_group_query_service import UiGroupQueryService
from app.utils.normalize import normalize_optional_string
from app.utils.time import utcnow


_BOOLEAN_GROUP_FIELDS = (
    "can_access_ceph_admin",
    "can_access_storage_ops",
    "can_create_manual_private_connections",
    "can_provision_managed_private_connections",
    "allow_multisite_endpoint_switching",
    "browser_advanced_features_enabled",
)


class UiGroupsService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.queries = UiGroupQueryService(db)

    def _existing_portal_scope(self, group_id: int) -> tuple[set[int], set[int]]:
        user_ids = set(
            self.db.scalars(
                select(UserUiGroup.user_id).where(UserUiGroup.group_id == group_id)
            ).all()
        )
        account_ids = set(
            self.db.scalars(
                select(UiGroupS3Account.account_id).where(UiGroupS3Account.group_id == group_id)
            ).all()
        )
        return user_ids, account_ids

    def create_group(self, payload: UiGroupCreate) -> UiGroup:
        name = self._available_name(payload.name)
        affected_user_ids = {int(user_id) for user_id in payload.user_ids}
        affected_account_ids = {int(link.account_id) for link in payload.account_links}
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        manager_tool_access = payload.manager_tool_access
        now = utcnow()
        group = UiGroup(
            name=name,
            description=normalize_optional_string(payload.description),
            **{
                field: getattr(payload, field)
                for field in _BOOLEAN_GROUP_FIELDS
            },
            **manager_tool_column_values(manager_tool_access),
            created_at=now,
            updated_at=now,
        )
        self.db.add(group)
        self.db.flush()
        UiGroupAvatarService(self.db).set_choice(group, payload.avatar_source, payload.avatar_icon)
        self._set_user_links(group, payload.user_ids)
        self._set_account_links(group, payload.account_links)
        self._set_s3_user_links(group, payload.s3_user_links)
        self._set_s3_connection_links(group, payload.s3_connection_ids)
        if payload.openstack_cloud_ids:
            self._set_openstack_cloud_links(group, payload.openstack_cloud_ids)
        self.db.flush()
        commit_portal_role_changes(
            self.db,
            before=portal_roles_before,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        self.db.refresh(group)
        return group

    def update_group(self, group_id: int, payload: UiGroupUpdate) -> UiGroup:
        group = self.db.get(UiGroup, group_id)
        if not group:
            raise UiGroupNotFoundError("UI group not found")
        affected_user_ids, affected_account_ids = self._updated_portal_scope(group.id, payload)
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        self._apply_group_update(group, payload)
        group.updated_at = utcnow()
        self.db.add(group)
        self.db.flush()
        commit_portal_role_changes(
            self.db,
            before=portal_roles_before,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        self.db.refresh(group)
        return group

    def _updated_portal_scope(
        self,
        group_id: int,
        payload: UiGroupUpdate,
    ) -> tuple[set[int], set[int]]:
        existing_user_ids, existing_account_ids = self._existing_portal_scope(group_id)
        affected_user_ids = existing_user_ids | {
            int(user_id) for user_id in (payload.user_ids or [])
        }
        affected_account_ids = existing_account_ids | {
            int(link.account_id) for link in (payload.account_links or [])
        }
        return affected_user_ids, affected_account_ids

    def _apply_group_update(self, group: UiGroup, payload: UiGroupUpdate) -> None:
        self._apply_group_field_update(group, payload)
        self._sync_group_associations(group, payload)

    def _apply_group_field_update(self, group: UiGroup, payload: UiGroupUpdate) -> None:
        fields = payload.model_fields_set
        if "name" in fields:
            if group.system_key and payload.name.strip() != group.name:
                raise ValueError("System groups cannot be renamed")
            group.name = self._available_name(payload.name, exclude_id=group.id)
        if "description" in fields:
            group.description = normalize_optional_string(payload.description)
        if "avatar_source" in fields or "avatar_icon" in fields:
            avatar_source = payload.avatar_source if "avatar_source" in fields else group.avatar_source
            avatar_icon = payload.avatar_icon if "avatar_icon" in fields else group.avatar_icon
            UiGroupAvatarService(self.db).set_choice(group, avatar_source, avatar_icon)
        for field in _BOOLEAN_GROUP_FIELDS:
            value = getattr(payload, field)
            if value is not None:
                setattr(group, field, value)
        if payload.manager_tool_access is not None:
            for column, value in manager_tool_column_values(payload.manager_tool_access).items():
                setattr(group, column, value)

    def _sync_group_associations(self, group: UiGroup, payload: UiGroupUpdate) -> None:
        if payload.user_ids is not None:
            if group.system_key:
                raise ValueError("System groups use implicit membership")
            self._set_user_links(group, payload.user_ids)
        if payload.account_links is not None:
            self._set_account_links(group, payload.account_links)
        if payload.s3_user_links is not None:
            self._set_s3_user_links(group, payload.s3_user_links)
        if payload.s3_connection_ids is not None:
            self._set_s3_connection_links(group, payload.s3_connection_ids)
        if payload.openstack_cloud_ids is not None:
            self._set_openstack_cloud_links(group, payload.openstack_cloud_ids)

    def delete_group(self, group_id: int) -> None:
        group = self.db.get(UiGroup, group_id)
        if not group:
            raise UiGroupNotFoundError("UI group not found")
        if group.system_key:
            raise ValueError("System groups cannot be deleted")
        affected_user_ids, affected_account_ids = self._existing_portal_scope(group.id)
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        self.db.delete(group)
        self.db.flush()
        commit_portal_role_changes(
            self.db,
            before=portal_roles_before,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
            sync_promotions=False,
        )

    def get_group(self, group_id: int) -> Optional[UiGroup]:
        return self.queries.get_group(group_id)

    def paginate_group_summaries(
        self,
        *,
        page: int,
        page_size: int,
        search: Optional[str] = None,
    ) -> tuple[list[UiGroupSummary], int]:
        return self.queries.paginate_group_summaries(
            page=page,
            page_size=page_size,
            search=search,
        )

    def list_groups_page(
        self,
        request: UiGroupListingRequest,
    ) -> PaginatedUiGroupsResponse:
        return self.queries.list_groups_page(request)

    def group_to_out(self, group: UiGroup) -> UiGroupOut:
        return self.queries.group_to_out(group)

    def _set_user_links(self, group: UiGroup, target_ids: list[int]) -> None:
        cleaned_ids = self._clean_ids(target_ids)
        ensure_association_ids_exist(
            self.db,
            User.id,
            cleaned_ids,
            entity_label="Users",
        )
        changed_user_ids = sync_simple_association_links(
            self.db,
            link_model=UserUiGroup,
            owner_column=UserUiGroup.group_id,
            owner_id=group.id,
            target_column=UserUiGroup.user_id,
            desired_ids=cleaned_ids,
            link_factory=lambda user_id: UserUiGroup(
                user_id=user_id,
                group_id=group.id,
            ),
        )
        if changed_user_ids:
            affected_cloud_ids = {
                int(cloud_id)
                for cloud_id in self.db.scalars(
                    select(cloud_groups.c.cloud_id).where(
                        cloud_groups.c.group_id == group.id
                    )
                ).all()
            }
        else:
            affected_cloud_ids = set()
        if affected_cloud_ids:
            from app.services.openstack_service import OpenStackService

            OpenStackService(self.db).invalidate_user_access(
                {int(user_id) for user_id in changed_user_ids},
                affected_cloud_ids,
            )

    def _set_account_links(self, group: UiGroup, links: list[AccountMembership]) -> None:
        cleaned = {int(link.account_id): link for link in links}
        ensure_association_ids_exist(
            self.db,
            S3Account.id,
            cleaned,
            entity_label="S3 accounts",
        )

        sync_metadata_association_links(
            self.db,
            link_model=UiGroupS3Account,
            owner_column=UiGroupS3Account.group_id,
            owner_id=group.id,
            target_column=UiGroupS3Account.account_id,
            desired_by_id=cleaned,
            link_factory=lambda account_id, _payload: UiGroupS3Account(
                group_id=group.id,
                account_id=account_id,
            ),
            update_link=update_account_access_link,
        )

    def _set_s3_user_links(self, group: UiGroup, links: list[S3UserMembership]) -> None:
        cleaned = {int(link.s3_user_id): link for link in links}
        cleaned_ids = sorted(cleaned)
        ensure_association_ids_exist(
            self.db,
            S3User.id,
            cleaned_ids,
            entity_label="S3 users",
        )
        sync_metadata_association_links(
            self.db,
            link_model=UiGroupS3User,
            owner_column=UiGroupS3User.group_id,
            owner_id=group.id,
            target_column=UiGroupS3User.s3_user_id,
            desired_by_id=cleaned,
            link_factory=lambda s3_user_id, _link: UiGroupS3User(
                group_id=group.id,
                s3_user_id=s3_user_id,
            ),
            update_link=lambda row, link: setattr(
                row,
                "allow_manager_browser_data_access",
                link.allow_manager_browser_data_access,
            ),
        )

    def _set_s3_connection_links(self, group: UiGroup, target_ids: list[int]) -> None:
        cleaned_ids = self._clean_ids(target_ids)
        ensure_shared_s3_connections(self.db, cleaned_ids)
        sync_simple_association_links(
            self.db,
            link_model=UiGroupS3Connection,
            owner_column=UiGroupS3Connection.group_id,
            owner_id=group.id,
            target_column=UiGroupS3Connection.s3_connection_id,
            desired_ids=cleaned_ids,
            link_factory=lambda connection_id: UiGroupS3Connection(
                group_id=group.id,
                s3_connection_id=connection_id,
            ),
        )

    def _set_openstack_cloud_links(self, group: UiGroup, target_ids: list[int]) -> None:
        from app.services.openstack_service import OpenStackService

        service = OpenStackService(self.db)
        service.require_enabled()
        cleaned_ids = set(self._clean_ids(target_ids))
        ensure_association_ids_exist(
            self.db,
            OpenStackCloud.id,
            cleaned_ids,
            entity_label="OpenStack clouds",
        )
        changed_ids = sync_table_association_links(
            self.db,
            table=cloud_groups,
            owner_column=cloud_groups.c.group_id,
            owner_id=group.id,
            target_column=cloud_groups.c.cloud_id,
            desired_ids=cleaned_ids,
        )
        if not changed_ids:
            return

        if group.system_key == ALL_USERS_SYSTEM_KEY:
            service.invalidate_cloud_access(changed_ids)
            return
        user_ids = {
            int(user_id)
            for user_id in self.db.scalars(
                select(UserUiGroup.user_id).where(UserUiGroup.group_id == group.id)
            ).all()
        }
        service.invalidate_user_access(user_ids, changed_ids)

    def _clean_ids(self, ids: list[int]) -> list[int]:
        return sorted({int(item) for item in ids if item is not None})

    def _normalize_name(self, value: str) -> str:
        name = str(value or "").strip()
        if not name:
            raise ValueError("UI group name is required")
        return name

    def _available_name(self, value: str, *, exclude_id: Optional[int] = None) -> str:
        name = self._normalize_name(value)
        statement = select(UiGroup.id).where(func.lower(UiGroup.name) == name.lower())
        if exclude_id is not None:
            statement = statement.where(UiGroup.id != exclude_id)
        if self.db.scalar(statement.limit(1)) is not None:
            raise ValueError("UI group already exists")
        return name

def get_ui_groups_service(db: Session) -> UiGroupsService:
    return UiGroupsService(db)
