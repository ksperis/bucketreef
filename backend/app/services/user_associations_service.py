# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3AccountNotFoundError, UiUserNotFoundError
from app.db import (
    S3Account,
    S3User,
    UiGroup,
    UiGroupS3Account,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.core.domain_enums import UserRole
from app.db.openstack import OpenStackCloud, cloud_groups, cloud_users
from app.models.user import AccountMembership, S3UserMembership, UserAssociationsPayload
from app.services.association_sync import (
    sync_metadata_association_links,
    sync_simple_association_links,
    sync_table_association_links,
    update_account_access_link,
)
from app.services.association_validation import ensure_association_ids_exist, ensure_shared_s3_connections
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    commit_portal_role_changes,
)
from app.utils.account_roles import ManagerAccountRoleValue, PortalAccountRoleValue
from app.utils.time import utcnow


class UserAssociationsService:
    """Validate and synchronize a UI user's direct associations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def apply_updates(self, user: User, payload: UserAssociationsPayload) -> None:
        if payload.account_links is not None:
            self.set_account_links(user, payload.account_links)
        if payload.s3_user_links is not None:
            self.set_s3_user_links(user, payload.s3_user_links)
        if payload.s3_connection_ids is not None:
            self.set_s3_connection_links(user, payload.s3_connection_ids)
        if payload.group_ids is not None:
            self.set_group_links(user, payload.group_ids)
        if payload.openstack_cloud_ids is not None:
            self.set_openstack_cloud_links(user, payload.openstack_cloud_ids)

    def affected_portal_account_ids(
        self,
        user: User,
        payload: UserAssociationsPayload,
    ) -> list[int]:
        if payload.account_links is None and payload.group_ids is None:
            return []
        account_ids = {
            int(account_id)
            for account_id in self.db.scalars(
                select(UserS3Account.account_id).where(UserS3Account.user_id == user.id)
            ).all()
        }
        account_ids.update(
            int(link.account_id)
            for link in (payload.account_links or [])
        )
        if payload.group_ids is not None:
            existing_group_ids = {
                int(group_id)
                for group_id in self.db.scalars(
                    select(UserUiGroup.group_id).where(UserUiGroup.user_id == user.id)
                ).all()
            }
            affected_group_ids = existing_group_ids | {
                int(group_id) for group_id in payload.group_ids
            }
            if affected_group_ids:
                account_ids.update(
                    int(account_id)
                    for account_id in self.db.scalars(
                        select(UiGroupS3Account.account_id).where(
                            UiGroupS3Account.group_id.in_(affected_group_ids)
                        )
                    ).all()
                )
        return sorted(account_ids)

    def set_account_links(
        self,
        user: User,
        links: list[AccountMembership],
    ) -> None:
        cleaned = {int(link.account_id): link for link in links}
        ensure_association_ids_exist(
            self.db,
            S3Account.id,
            cleaned,
            entity_label="S3 accounts",
        )
        desired_ids = set(cleaned)

        sync_metadata_association_links(
            self.db,
            link_model=UserS3Account,
            owner_column=UserS3Account.user_id,
            owner_id=user.id,
            target_column=UserS3Account.account_id,
            desired_by_id=cleaned,
            link_factory=lambda account_id, _link: UserS3Account(
                user_id=user.id,
                account_id=account_id,
            ),
            update_link=update_account_access_link,
        )
        if desired_ids and user.role == UserRole.UI_NONE.value:
            user.role = UserRole.UI_USER.value

    def assign_account(
        self,
        user_id: int,
        account_id: int,
        *,
        manager_role: ManagerAccountRoleValue | None,
        portal_role: PortalAccountRoleValue | None,
    ) -> User:
        user = self.db.get(User, user_id)
        if not user:
            raise UiUserNotFoundError("User not found")
        account = self.db.get(S3Account, account_id)
        if not account:
            raise S3AccountNotFoundError("S3Account not found")

        before_roles = capture_effective_portal_roles(
            self.db,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        self._upsert_direct_account_link(
            user,
            account,
            manager_role=manager_role,
            portal_role=portal_role,
        )

        commit_portal_role_changes(
            self.db,
            before=before_roles,
            user_ids=[user.id],
            account_ids=[account.id],
        )
        self.db.refresh(user)
        return user

    def _upsert_direct_account_link(
        self,
        user: User,
        account: S3Account,
        *,
        manager_role: ManagerAccountRoleValue | None,
        portal_role: PortalAccountRoleValue | None,
    ) -> None:
        link = self.db.scalar(
            select(UserS3Account)
            .where(
                UserS3Account.user_id == user.id,
                UserS3Account.account_id == account.id,
            )
            .limit(1)
        )
        if user.role == UserRole.UI_NONE.value:
            user.role = UserRole.UI_USER.value
        membership = AccountMembership(
            account_id=account.id,
            manager_role=manager_role,
            portal_role=portal_role,
        )
        if not link:
            link = UserS3Account(
                user_id=user.id,
                account_id=account.id,
                manager_role=membership.manager_role,
                portal_role=membership.portal_role,
            )
        link.manager_role = membership.manager_role
        link.portal_role = membership.portal_role
        link.updated_at = utcnow()
        self.db.add(link)
        self.db.add(user)
        self.db.flush()

    def set_s3_user_links(
        self,
        user: User,
        links: list[S3UserMembership],
    ) -> None:
        cleaned = {int(link.s3_user_id): link for link in links}
        sync_metadata_association_links(
            self.db,
            link_model=UserS3User,
            owner_column=UserS3User.user_id,
            owner_id=user.id,
            target_column=UserS3User.s3_user_id,
            desired_by_id=cleaned,
            link_factory=lambda s3_user_id, _link: UserS3User(
                user_id=user.id,
                s3_user_id=s3_user_id,
            ),
            update_link=lambda row, link: setattr(
                row,
                "allow_manager_browser_data_access",
                bool(link.allow_manager_browser_data_access),
            ),
            before_create=lambda new_ids: ensure_association_ids_exist(
                self.db,
                S3User.id,
                new_ids,
                entity_label="S3 users",
            ),
        )

    def set_s3_connection_links(
        self,
        user: User,
        target_ids: list[int],
    ) -> None:
        cleaned_ids = {
            int(connection_id)
            for connection_id in target_ids
            if connection_id is not None
        }
        ensure_shared_s3_connections(self.db, cleaned_ids)
        sync_simple_association_links(
            self.db,
            link_model=UserS3Connection,
            owner_column=UserS3Connection.user_id,
            owner_id=user.id,
            target_column=UserS3Connection.s3_connection_id,
            desired_ids=cleaned_ids,
            link_factory=lambda connection_id: UserS3Connection(
                user_id=user.id,
                s3_connection_id=connection_id,
            ),
        )

    def set_openstack_cloud_links(
        self,
        user: User,
        target_ids: list[int],
    ) -> None:
        from app.services.openstack_service import OpenStackService

        openstack = OpenStackService(self.db)
        openstack.require_enabled()
        cleaned_ids = {
            int(cloud_id)
            for cloud_id in target_ids
            if cloud_id is not None
        }
        ensure_association_ids_exist(
            self.db,
            OpenStackCloud.id,
            cleaned_ids,
            entity_label="OpenStack clouds",
        )
        changed_ids = sync_table_association_links(
            self.db,
            table=cloud_users,
            owner_column=cloud_users.c.user_id,
            owner_id=user.id,
            target_column=cloud_users.c.cloud_id,
            desired_ids=cleaned_ids,
        )
        if not changed_ids:
            return
        openstack.invalidate_user_access({int(user.id)}, changed_ids)

    def set_group_links(self, user: User, target_ids: list[int]) -> None:
        cleaned_ids = {
            int(group_id)
            for group_id in target_ids
            if group_id is not None
        }
        ensure_association_ids_exist(
            self.db,
            UiGroup.id,
            cleaned_ids,
            entity_label="UI groups",
        )
        if cleaned_ids:
            system_group_id = self.db.scalar(
                select(UiGroup.id).where(
                    UiGroup.id.in_(cleaned_ids),
                    UiGroup.system_key.is_not(None),
                ).limit(1)
            )
            if system_group_id is not None:
                raise ValueError("System groups use implicit membership")
        changed_group_ids = sync_simple_association_links(
            self.db,
            link_model=UserUiGroup,
            owner_column=UserUiGroup.user_id,
            owner_id=user.id,
            target_column=UserUiGroup.group_id,
            desired_ids=cleaned_ids,
            link_factory=lambda group_id: UserUiGroup(
                user_id=user.id,
                group_id=group_id,
            ),
        )
        affected_cloud_ids = {
            int(cloud_id)
            for cloud_id in self.db.scalars(
                select(cloud_groups.c.cloud_id).where(
                    cloud_groups.c.group_id.in_(changed_group_ids)
                )
            ).all()
        } if changed_group_ids else set()
        if affected_cloud_ids:
            from app.services.openstack_service import OpenStackService

            OpenStackService(self.db).invalidate_user_access(
                {int(user.id)},
                affected_cloud_ids,
            )

    def groups_grant_ceph_admin(
        self,
        group_ids: list[int] | None,
    ) -> bool:
        cleaned_ids = {
            int(group_id)
            for group_id in (group_ids or [])
            if group_id is not None
        }
        if not cleaned_ids:
            return False
        return self.db.scalar(
            select(UiGroup.id)
            .where(
                UiGroup.id.in_(cleaned_ids),
                UiGroup.can_access_ceph_admin.is_(True),
            )
            .limit(1)
        ) is not None


def get_user_associations_service(db: Session) -> UserAssociationsService:
    return UserAssociationsService(db)
