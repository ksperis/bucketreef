# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.core.domain_errors import UiGroupNotFoundError
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
from app.models.ui_group import LinkedS3Account, UiGroupCreate, UiGroupOut, UiGroupSummary, UiGroupUpdate
from app.models.user import (
    AccountMembership,
    LinkedS3Connection,
    LinkedS3User,
    ManagerToolAccess,
    S3UserMembership,
    UserSummary,
)
from app.services.association_names import load_s3_user_names, load_shared_s3_connection_names
from app.services.association_validation import ensure_association_ids_exist, ensure_shared_s3_connections
from app.services.manager_tool_access import manager_tool_column_values, read_manager_tool_access
from app.services.portal_role_sync import (
    PortalRoleMap,
    capture_effective_portal_roles,
    sync_portal_role_downgrades,
    sync_portal_role_promotions,
)
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.name_ordering import name_order_by
from app.utils.normalize import normalize_optional_string
from app.utils.time import utcnow


@dataclass(frozen=True)
class _UiGroupOutputPreload:
    users: list[User]
    account_links: list[UiGroupS3Account]
    s3_user_links: list[UiGroupS3User]
    s3_connection_ids: list[int]
    account_names: dict[int, tuple[str, str]]
    s3_user_names: dict[int, str]
    s3_connection_names: dict[int, str]


class UiGroupsService:
    def __init__(self, db: Session) -> None:
        self.db = db

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

    def _commit_portal_role_changes(
        self,
        *,
        before: PortalRoleMap,
        user_ids: set[int],
        account_ids: set[int],
        sync_promotions: bool = True,
    ) -> None:
        after = capture_effective_portal_roles(
            self.db,
            user_ids=user_ids,
            account_ids=account_ids,
        )
        try:
            sync_portal_role_downgrades(self.db, before=before, after=after)
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        if sync_promotions:
            sync_portal_role_promotions(self.db, before=before, after=after)

    def create_group(self, payload: UiGroupCreate) -> UiGroup:
        name = self._normalize_name(payload.name)
        if self.db.scalar(select(UiGroup).where(func.lower(UiGroup.name) == name.lower())):
            raise ValueError("UI group already exists")
        affected_user_ids = {int(user_id) for user_id in payload.user_ids}
        affected_account_ids = {int(link.account_id) for link in payload.account_links}
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        manager_tool_access = payload.manager_tool_access or ManagerToolAccess()
        now = utcnow()
        group = UiGroup(
            name=name,
            description=normalize_optional_string(payload.description),
            can_access_ceph_admin=bool(payload.can_access_ceph_admin),
            can_access_storage_ops=bool(payload.can_access_storage_ops),
            can_create_manual_private_connections=bool(payload.can_create_manual_private_connections),
            can_provision_managed_private_connections=bool(payload.can_provision_managed_private_connections),
            **manager_tool_column_values(manager_tool_access),
            browser_advanced_features_enabled=bool(payload.browser_advanced_features_enabled),
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
        self.db.flush()
        self._commit_portal_role_changes(
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
        existing_user_ids, existing_account_ids = self._existing_portal_scope(group.id)
        affected_user_ids = existing_user_ids | {
            int(user_id) for user_id in (payload.user_ids or [])
        }
        affected_account_ids = existing_account_ids | {
            int(link.account_id) for link in (payload.account_links or [])
        }
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        if payload.name is not None:
            name = self._normalize_name(payload.name)
            existing = self.db.scalar(select(UiGroup).where(func.lower(UiGroup.name) == name.lower()))
            if existing and existing.id != group.id:
                raise ValueError("UI group already exists")
            group.name = name
        if payload.description is not None:
            group.description = normalize_optional_string(payload.description)
        if payload.avatar_source is not None:
            UiGroupAvatarService(self.db).set_choice(group, payload.avatar_source, payload.avatar_icon)
        if payload.can_access_ceph_admin is not None:
            group.can_access_ceph_admin = bool(payload.can_access_ceph_admin)
        if payload.can_access_storage_ops is not None:
            group.can_access_storage_ops = bool(payload.can_access_storage_ops)
        if payload.can_create_manual_private_connections is not None:
            group.can_create_manual_private_connections = bool(payload.can_create_manual_private_connections)
        if payload.can_provision_managed_private_connections is not None:
            group.can_provision_managed_private_connections = bool(payload.can_provision_managed_private_connections)
        if payload.manager_tool_access is not None:
            for column, value in manager_tool_column_values(payload.manager_tool_access).items():
                setattr(group, column, value)
        if payload.browser_advanced_features_enabled is not None:
            group.browser_advanced_features_enabled = bool(payload.browser_advanced_features_enabled)
        if payload.user_ids is not None:
            self._set_user_links(group, payload.user_ids)
        if payload.account_links is not None:
            self._set_account_links(group, payload.account_links)
        if payload.s3_user_links is not None:
            self._set_s3_user_links(group, payload.s3_user_links)
        if payload.s3_connection_ids is not None:
            self._set_s3_connection_links(group, payload.s3_connection_ids)
        group.updated_at = utcnow()
        self.db.add(group)
        self.db.flush()
        self._commit_portal_role_changes(
            before=portal_roles_before,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        self.db.refresh(group)
        return group

    def delete_group(self, group_id: int) -> None:
        group = self.db.get(UiGroup, group_id)
        if not group:
            raise UiGroupNotFoundError("UI group not found")
        affected_user_ids, affected_account_ids = self._existing_portal_scope(group.id)
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
        )
        self.db.delete(group)
        self.db.flush()
        self._commit_portal_role_changes(
            before=portal_roles_before,
            user_ids=affected_user_ids,
            account_ids=affected_account_ids,
            sync_promotions=False,
        )

    def get_group(self, group_id: int) -> Optional[UiGroup]:
        return self.db.get(UiGroup, group_id)

    def list_groups_minimal(self) -> list[UiGroupSummary]:
        rows = self.db.scalars(select(UiGroup).order_by(*name_order_by(UiGroup))).all()
        avatar_service = UiGroupAvatarService(self.db)
        return [UiGroupSummary(id=row.id, name=row.name, avatar=avatar_service.descriptor(row)) for row in rows]

    @staticmethod
    def _apply_group_search(statement, search_value: str):
        if not search_value:
            return statement
        member = aliased(User)
        account = aliased(S3Account)
        s3_user = aliased(S3User)
        connection = aliased(S3Connection)
        pattern = f"%{search_value}%"
        return (
            statement.outerjoin(UserUiGroup, UiGroup.id == UserUiGroup.group_id)
            .outerjoin(member, UserUiGroup.user_id == member.id)
            .outerjoin(UiGroupS3Account, UiGroup.id == UiGroupS3Account.group_id)
            .outerjoin(account, UiGroupS3Account.account_id == account.id)
            .outerjoin(UiGroupS3User, UiGroup.id == UiGroupS3User.group_id)
            .outerjoin(s3_user, UiGroupS3User.s3_user_id == s3_user.id)
            .outerjoin(UiGroupS3Connection, UiGroup.id == UiGroupS3Connection.group_id)
            .outerjoin(
                connection,
                and_(
                    UiGroupS3Connection.s3_connection_id == connection.id,
                    connection.is_shared.is_(True),
                ),
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
                )
            )
            .distinct()
        )

    @staticmethod
    def _group_order_columns(sort_field: str, sort_direction: str):
        descending = sort_direction == "desc"
        if sort_field == "name" or sort_field not in {"created_at", "updated_at"}:
            if descending:
                return (
                    func.lower(UiGroup.name).desc(),
                    UiGroup.name.desc(),
                    UiGroup.id.desc(),
                )
            return name_order_by(UiGroup)
        sort_column = UiGroup.created_at if sort_field == "created_at" else UiGroup.updated_at
        direction = sort_column.desc if descending else sort_column.asc
        id_direction = UiGroup.id.desc if descending else UiGroup.id.asc
        return direction(), id_direction()

    def paginate_groups(
        self,
        *,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
    ) -> tuple[list[UiGroupOut], int]:
        search_value = search.strip() if isinstance(search, str) else ""
        statement = self._apply_group_search(select(UiGroup), search_value)
        total = self.db.scalar(
            select(func.count()).select_from(statement.order_by(None).subquery())
        ) or 0
        offset = max(page - 1, 0) * page_size
        rows = self.db.scalars(
            statement.order_by(*self._group_order_columns(sort_field, sort_direction))
            .offset(offset)
            .limit(page_size)
        ).all()
        return [self.group_to_out(group) for group in rows], total

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
            .join(S3Connection, S3Connection.id == UiGroupS3Connection.s3_connection_id)
            .where(
                UiGroupS3Connection.group_id == group_id,
                S3Connection.is_shared.is_(True),
            )
        ).all()
        s3_user_ids = sorted(row.s3_user_id for row in s3_user_rows)
        s3_connection_ids = sorted(s3_connection_ids)
        account_ids = sorted(link.account_id for link in account_rows)
        return _UiGroupOutputPreload(
            users=user_rows,
            account_links=account_rows,
            s3_user_links=s3_user_rows,
            s3_connection_ids=s3_connection_ids,
            account_names=self._load_account_names(account_ids),
            s3_user_names=load_s3_user_names(self.db, s3_user_ids),
            s3_connection_names=load_shared_s3_connection_names(
                self.db,
                s3_connection_ids,
            ),
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
    def _group_account_links(links: list[UiGroupS3Account]) -> list[AccountMembership]:
        return [
            AccountMembership(
                account_id=link.account_id,
                manager_role=link.manager_role,
                portal_role=link.portal_role,
                allow_manager_browser_data_access=bool(link.allow_manager_browser_data_access),
            )
            for link in links
        ]

    @staticmethod
    def _group_s3_user_links(links: list[UiGroupS3User]) -> list[S3UserMembership]:
        return [
            S3UserMembership(
                s3_user_id=link.s3_user_id,
                allow_manager_browser_data_access=bool(link.allow_manager_browser_data_access),
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
            LinkedS3User(id=s3_id, name=names.get(s3_id) or f"S3 User #{s3_id}")
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
            description=group.description,
            avatar=UiGroupAvatarService(self.db).descriptor(group),
            can_access_ceph_admin=bool(group.can_access_ceph_admin),
            can_access_storage_ops=bool(group.can_access_storage_ops),
            can_create_manual_private_connections=bool(group.can_create_manual_private_connections),
            can_provision_managed_private_connections=bool(group.can_provision_managed_private_connections),
            manager_tool_access=read_manager_tool_access(group),
            browser_advanced_features_enabled=bool(group.browser_advanced_features_enabled),
            user_details=self._group_user_details(preload.users),
            account_details=self._group_account_details(preload.account_links, preload.account_names),
            account_links=self._group_account_links(preload.account_links),
            s3_user_links=self._group_s3_user_links(preload.s3_user_links),
            s3_user_details=self._group_s3_user_details(preload.s3_user_links, preload.s3_user_names),
            s3_connection_details=self._group_s3_connection_details(
                preload.s3_connection_ids,
                preload.s3_connection_names,
            ),
            created_at=group.created_at,
            updated_at=group.updated_at,
        )

    def _set_user_links(self, group: UiGroup, target_ids: list[int]) -> None:
        cleaned_ids = self._clean_ids(target_ids)
        ensure_association_ids_exist(
            self.db,
            User.id,
            cleaned_ids,
            entity_label="Users",
        )
        existing = self.db.scalars(
            select(UserUiGroup).where(UserUiGroup.group_id == group.id)
        ).all()
        existing_ids = {link.user_id for link in existing}
        desired_ids = set(cleaned_ids)
        self._delete_removed_user_links(group.id, existing_ids - desired_ids)
        for user_id in desired_ids - existing_ids:
            self.db.add(UserUiGroup(user_id=user_id, group_id=group.id))

    def _set_account_links(self, group: UiGroup, links: list[AccountMembership]) -> None:
        cleaned = {int(link.account_id): link for link in links}
        ensure_association_ids_exist(
            self.db,
            S3Account.id,
            cleaned,
            entity_label="S3 accounts",
        )
        existing = self.db.scalars(
            select(UiGroupS3Account).where(UiGroupS3Account.group_id == group.id)
        ).all()
        existing_by_id = {link.account_id: link for link in existing}
        desired_ids = set(cleaned)
        for account_id in set(existing_by_id) - desired_ids:
            self.db.delete(existing_by_id[account_id])
        for account_id, payload in cleaned.items():
            row = existing_by_id.get(account_id)
            if row is None:
                row = UiGroupS3Account(
                    group_id=group.id,
                    account_id=account_id,
                    manager_role=payload.manager_role,
                    portal_role=payload.portal_role,
                    allow_manager_browser_data_access=bool(
                        payload.allow_manager_browser_data_access
                    ),
                )
            row.manager_role = payload.manager_role
            row.portal_role = payload.portal_role
            row.allow_manager_browser_data_access = bool(
                payload.allow_manager_browser_data_access
            )
            row.updated_at = utcnow()
            self.db.add(row)

    def _set_s3_user_links(self, group: UiGroup, links: list[S3UserMembership]) -> None:
        cleaned = {int(link.s3_user_id): link for link in links}
        cleaned_ids = sorted(cleaned)
        ensure_association_ids_exist(
            self.db,
            S3User.id,
            cleaned_ids,
            entity_label="S3 users",
        )
        existing = self.db.scalars(
            select(UiGroupS3User).where(UiGroupS3User.group_id == group.id)
        ).all()
        existing_by_id = {link.s3_user_id: link for link in existing}
        existing_ids = set(existing_by_id)
        desired_ids = set(cleaned_ids)
        for s3_user_id in existing_ids - desired_ids:
            self.db.execute(
                delete(UiGroupS3User)
                .where(
                    UiGroupS3User.group_id == group.id,
                    UiGroupS3User.s3_user_id == s3_user_id,
                )
                .execution_options(synchronize_session=False)
            )
        for s3_user_id in desired_ids - existing_ids:
            self.db.add(
                UiGroupS3User(
                    group_id=group.id,
                    s3_user_id=s3_user_id,
                    allow_manager_browser_data_access=bool(
                        cleaned[s3_user_id].allow_manager_browser_data_access
                    ),
                )
            )
        for s3_user_id in desired_ids & existing_ids:
            row = existing_by_id[s3_user_id]
            row.allow_manager_browser_data_access = bool(
                cleaned[s3_user_id].allow_manager_browser_data_access
            )
            self.db.add(row)

    def _set_s3_connection_links(self, group: UiGroup, target_ids: list[int]) -> None:
        cleaned_ids = self._clean_ids(target_ids)
        ensure_shared_s3_connections(self.db, cleaned_ids)
        existing = self.db.scalars(
            select(UiGroupS3Connection).where(UiGroupS3Connection.group_id == group.id)
        ).all()
        existing_ids = {link.s3_connection_id for link in existing}
        desired_ids = set(cleaned_ids)
        for connection_id in existing_ids - desired_ids:
            self.db.execute(
                delete(UiGroupS3Connection)
                .where(
                    UiGroupS3Connection.group_id == group.id,
                    UiGroupS3Connection.s3_connection_id == connection_id,
                )
                .execution_options(synchronize_session=False)
            )
        for connection_id in desired_ids - existing_ids:
            self.db.add(UiGroupS3Connection(group_id=group.id, s3_connection_id=connection_id))

    def _clean_ids(self, ids: list[int]) -> list[int]:
        return sorted({int(item) for item in ids if item is not None})

    def _normalize_name(self, value: str) -> str:
        name = str(value or "").strip()
        if not name:
            raise ValueError("UI group name is required")
        return name

    def _delete_removed_user_links(self, group_id: int, user_ids: set[int]) -> None:
        if not user_ids:
            return
        self.db.execute(
            delete(UserUiGroup)
            .where(
                UserUiGroup.group_id == group_id,
                UserUiGroup.user_id.in_(user_ids),
            )
            .execution_options(synchronize_session=False)
        )

    def _load_account_names(self, ids: list[int]) -> dict[int, tuple[str, str]]:
        if not ids:
            return {}
        rows = self.db.execute(
            select(S3Account.id, S3Account.name, S3Account.rgw_account_id).where(S3Account.id.in_(ids))
        ).all()
        return {row[0]: (row[1], row[2]) for row in rows}

def get_ui_groups_service(db: Session) -> UiGroupsService:
    return UiGroupsService(db)
