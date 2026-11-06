# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import S3User, UiGroup, UiGroupS3User, User, UserS3User
from app.core.domain_enums import UserRole, is_admin_ui_role
from app.models.s3_user import S3UserGroupLink, S3UserUserLink
from app.services.association_sync import sync_metadata_association_links
from app.services.association_validation import (
    ensure_association_ids_exist,
    load_association_users,
)
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService


class S3UserAssociationsService:
    """Load, validate, and synchronize an S3 user's UI associations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def replace_links(
        self,
        s3_user: S3User,
        *,
        user_links: list[S3UserUserLink] | None,
        group_links: list[S3UserGroupLink] | None,
    ) -> None:
        desired_users = (
            None
            if user_links is None
            else {
                int(link.user_id): link.allow_manager_browser_data_access
                for link in user_links
            }
        )
        desired_groups = (
            None
            if group_links is None
            else {
                int(link.group_id): link.allow_manager_browser_data_access
                for link in group_links
            }
        )

        users_by_id = self._load_desired_users(desired_users)
        if desired_groups:
            ensure_association_ids_exist(
                self.db,
                UiGroup.id,
                desired_groups,
                entity_label="UI groups",
            )

        if desired_users is not None:
            self._replace_user_links(s3_user, desired_users, users_by_id)
        if desired_groups is not None:
            self._replace_group_links(s3_user, desired_groups)

    def _load_desired_users(
        self,
        desired: dict[int, bool] | None,
    ) -> dict[int, User]:
        return load_association_users(self.db, desired or ())

    def _replace_user_links(
        self,
        s3_user: S3User,
        desired: dict[int, bool],
        users_by_id: dict[int, User],
    ) -> None:
        def promote_user_for_new_link(user_id: int, _allow_browser: bool) -> None:
            user = users_by_id[user_id]
            if (
                user.role != UserRole.UI_USER.value
                and not is_admin_ui_role(user.role)
            ):
                user.role = UserRole.UI_USER.value
                self.db.add(user)

        sync_metadata_association_links(
            self.db,
            link_model=UserS3User,
            owner_column=UserS3User.s3_user_id,
            owner_id=s3_user.id,
            target_column=UserS3User.user_id,
            desired_by_id=desired,
            link_factory=lambda user_id, _allow_browser: UserS3User(
                user_id=user_id,
                s3_user_id=s3_user.id,
            ),
            update_link=lambda row, allow_browser: setattr(
                row,
                "allow_manager_browser_data_access",
                allow_browser,
            ),
            on_create=promote_user_for_new_link,
        )

    def _replace_group_links(
        self,
        s3_user: S3User,
        desired: dict[int, bool],
    ) -> None:
        sync_metadata_association_links(
            self.db,
            link_model=UiGroupS3User,
            owner_column=UiGroupS3User.s3_user_id,
            owner_id=s3_user.id,
            target_column=UiGroupS3User.group_id,
            desired_by_id=desired,
            link_factory=lambda group_id, _allow_browser: UiGroupS3User(
                group_id=group_id,
                s3_user_id=s3_user.id,
            ),
            update_link=lambda row, allow_browser: setattr(
                row,
                "allow_manager_browser_data_access",
                allow_browser,
            ),
        )

    def load_links(
        self,
        s3_user_ids: list[int],
    ) -> tuple[
        dict[int, list[S3UserUserLink]],
        dict[int, list[S3UserGroupLink]],
    ]:
        return (
            self._load_user_links(s3_user_ids),
            self._load_group_links(s3_user_ids),
        )

    def _load_user_links(
        self,
        s3_user_ids: list[int],
    ) -> dict[int, list[S3UserUserLink]]:
        if not s3_user_ids:
            return {}
        rows = self.db.execute(
            select(
                UserS3User.s3_user_id,
                User,
                UserS3User.allow_manager_browser_data_access,
            )
            .join(User, User.id == UserS3User.user_id)
            .where(UserS3User.s3_user_id.in_(s3_user_ids))
            .order_by(UserS3User.s3_user_id.asc(), User.email.asc(), User.id.asc())
        ).all()
        links_by_s3_user: dict[int, list[S3UserUserLink]] = {}
        avatar_service = UserAvatarService(self.db)
        for s3_user_id, user, allow_browser in rows:
            normalized_s3_user_id = int(s3_user_id)
            links_by_s3_user.setdefault(normalized_s3_user_id, []).append(
                S3UserUserLink(
                    user_id=int(user.id),
                    user_email=user.email,
                    user_full_name=user.full_name,
                    user_avatar=avatar_service.descriptor(user),
                    allow_manager_browser_data_access=allow_browser,
                )
            )
        return links_by_s3_user

    def _load_group_links(
        self,
        s3_user_ids: list[int],
    ) -> dict[int, list[S3UserGroupLink]]:
        if not s3_user_ids:
            return {}
        rows = self.db.execute(
            select(
                UiGroupS3User.s3_user_id,
                UiGroup,
                UiGroupS3User.allow_manager_browser_data_access,
            )
            .join(UiGroup, UiGroup.id == UiGroupS3User.group_id)
            .where(UiGroupS3User.s3_user_id.in_(s3_user_ids))
            .order_by(
                UiGroupS3User.s3_user_id.asc(),
                UiGroup.name.asc(),
                UiGroup.id.asc(),
            )
        ).all()
        links_by_s3_user: dict[int, list[S3UserGroupLink]] = {}
        avatar_service = UiGroupAvatarService(self.db)
        for s3_user_id, group, allow_browser in rows:
            normalized_s3_user_id = int(s3_user_id)
            links_by_s3_user.setdefault(normalized_s3_user_id, []).append(
                S3UserGroupLink(
                    group_id=int(group.id),
                    group_name=group.name,
                    group_avatar=avatar_service.descriptor(group),
                    allow_manager_browser_data_access=allow_browser,
                )
            )
        return links_by_s3_user
