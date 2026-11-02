# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import S3Account, UiGroup, UiGroupS3Account, User, UserS3Account, UserUiGroup
from app.core.domain_enums import UserRole, is_admin_ui_role
from app.models.s3_account import (
    AccountGroupLink,
    AccountGroupLinkInput,
    AccountUserLink,
    AccountUserLinkInput,
    S3AccountUpdate,
)
from app.services.association_sync import sync_metadata_association_links
from app.services.association_validation import (
    ensure_association_ids_exist,
    load_association_users,
)
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.time import utcnow


class S3AccountAssociationsService:
    """Validate and synchronize an S3 account's direct associations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def load_user_links(
        self,
        account_ids: list[int],
    ) -> dict[int, list[AccountUserLink]]:
        if not account_ids:
            return {}
        rows = self.db.execute(
            select(
                UserS3Account.account_id,
                User,
                UserS3Account.manager_role,
                UserS3Account.portal_role,
                UserS3Account.allow_manager_browser_data_access,
            )
            .join(User, User.id == UserS3Account.user_id)
            .where(UserS3Account.account_id.in_(account_ids))
            .order_by(
                UserS3Account.account_id.asc(),
                User.email.asc(),
                User.id.asc(),
            )
        ).all()
        links_by_account: dict[int, list[AccountUserLink]] = {}
        avatars = UserAvatarService(self.db)
        for account_id, user, manager_role, portal_role, browser_access in rows:
            links_by_account.setdefault(int(account_id), []).append(
                AccountUserLink(
                    user_id=int(user.id),
                    manager_role=manager_role,
                    portal_role=portal_role,
                    allow_manager_browser_data_access=bool(browser_access),
                    user_email=user.email,
                    user_full_name=user.full_name,
                    user_avatar=avatars.descriptor(user),
                )
            )
        return links_by_account

    def load_group_links(
        self,
        account_ids: list[int],
    ) -> dict[int, list[AccountGroupLink]]:
        if not account_ids:
            return {}
        rows = self.db.execute(
            select(
                UiGroupS3Account.account_id,
                UiGroup,
                UiGroupS3Account.manager_role,
                UiGroupS3Account.portal_role,
                UiGroupS3Account.allow_manager_browser_data_access,
            )
            .join(UiGroup, UiGroup.id == UiGroupS3Account.group_id)
            .where(UiGroupS3Account.account_id.in_(account_ids))
            .order_by(
                UiGroupS3Account.account_id.asc(),
                UiGroup.name.asc(),
                UiGroup.id.asc(),
            )
        ).all()
        links_by_account: dict[int, list[AccountGroupLink]] = {}
        avatars = UiGroupAvatarService(self.db)
        for account_id, group, manager_role, portal_role, browser_access in rows:
            links_by_account.setdefault(int(account_id), []).append(
                AccountGroupLink(
                    group_id=int(group.id),
                    group_name=group.name,
                    group_avatar=avatars.descriptor(group),
                    manager_role=manager_role,
                    portal_role=portal_role,
                    allow_manager_browser_data_access=bool(browser_access),
                )
            )
        return links_by_account

    def affected_portal_user_ids(
        self,
        account: S3Account,
        payload: S3AccountUpdate,
    ) -> set[int]:
        user_ids: set[int] = set()
        if payload.user_links is not None:
            user_ids.update(
                int(user_id)
                for user_id in self.db.scalars(
                    select(UserS3Account.user_id).where(
                        UserS3Account.account_id == account.id
                    )
                )
            )
            user_ids.update(int(link.user_id) for link in payload.user_links)
        if payload.group_links is not None:
            group_ids = {
                int(group_id)
                for group_id in self.db.scalars(
                    select(UiGroupS3Account.group_id).where(
                        UiGroupS3Account.account_id == account.id
                    )
                )
            }
            group_ids.update(int(link.group_id) for link in payload.group_links)
            if group_ids:
                user_ids.update(
                    int(user_id)
                    for user_id in self.db.scalars(
                        select(UserUiGroup.user_id).where(
                            UserUiGroup.group_id.in_(group_ids)
                        )
                    )
                )
        return user_ids

    def set_user_links(
        self,
        account: S3Account,
        links: list[AccountUserLinkInput],
    ) -> None:
        cleaned = {int(link.user_id): link for link in links}

        users_by_id = load_association_users(
            self.db,
            cleaned,
            entity_label="User",
        )

        def promote_user_for_new_link(user_id: int, _link: AccountUserLinkInput) -> None:
            user = users_by_id[user_id]
            if not is_admin_ui_role(user.role):
                user.role = UserRole.UI_USER.value
                self.db.add(user)

        def update_link(row: UserS3Account, link: AccountUserLinkInput) -> None:
            row.manager_role = link.manager_role
            row.portal_role = link.portal_role
            row.allow_manager_browser_data_access = bool(
                link.allow_manager_browser_data_access
            )
            row.updated_at = utcnow()

        sync_metadata_association_links(
            self.db,
            link_model=UserS3Account,
            owner_column=UserS3Account.account_id,
            owner_id=account.id,
            target_column=UserS3Account.user_id,
            desired_by_id=cleaned,
            link_factory=lambda user_id, _link: UserS3Account(
                user_id=user_id,
                account_id=account.id,
            ),
            update_link=update_link,
            on_create=promote_user_for_new_link,
        )

    def set_group_links(
        self,
        account: S3Account,
        links: list[AccountGroupLinkInput],
    ) -> None:
        cleaned = {int(link.group_id): link for link in links}

        ensure_association_ids_exist(
            self.db,
            UiGroup.id,
            cleaned,
            entity_label="UI groups",
        )

        def update_link(row: UiGroupS3Account, link: AccountGroupLinkInput) -> None:
            row.manager_role = link.manager_role
            row.portal_role = link.portal_role
            row.allow_manager_browser_data_access = bool(
                link.allow_manager_browser_data_access
            )
            row.updated_at = utcnow()

        sync_metadata_association_links(
            self.db,
            link_model=UiGroupS3Account,
            owner_column=UiGroupS3Account.account_id,
            owner_id=account.id,
            target_column=UiGroupS3Account.group_id,
            desired_by_id=cleaned,
            link_factory=lambda group_id, _link: UiGroupS3Account(
                group_id=group_id,
                account_id=account.id,
            ),
            update_link=update_link,
        )
