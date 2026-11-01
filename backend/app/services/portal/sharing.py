# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from sqlalchemy import exists, func, or_, select

from app.db import (
    PortalAccountRole,
    PortalPublicLink as DBPortalPublicLink,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
    UiGroupS3Account,
    User,
    UserS3Account,
    UserUiGroup,
)
from app.models.portal_storage_spaces import (
    PortalStorageSpaceGrantRole,
    PortalStorageSpaceInitialShare,
    PortalStorageSpaceShareScope,
    PortalStorageSpaceVisibility,
)
from app.models.portal_sharing import (
    PortalStorageSpaceAccessPerson,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
)
from app.services.portal.exceptions import (
    PortalBadRequestError,
    PortalConflictError,
    PortalForbiddenError,
    PortalNotFoundError,
)
from app.services.user_avatar_service import UserAvatarService
from app.services.sqlalchemy_pagination import paginate_scalars
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.models.access_context import AccountAccess


class PortalSharingMixin:
    def _storage_space_grant(
        self,
        storage_space_metadata_id: int,
        user_id: int,
    ) -> PortalStorageSpaceGrant | None:
        return self.db.scalar(
            select(PortalStorageSpaceGrant).where(
                PortalStorageSpaceGrant.storage_space_metadata_id == storage_space_metadata_id,
                PortalStorageSpaceGrant.user_id == user_id,
            )
        )

    def _portal_user_can_create_external_sharing(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
    ) -> bool:
        if access.portal_role != PortalAccountRole.PORTAL_USER.value:
            return False
        metadata = self._storage_space_metadata(access.account, bucket_name)
        if metadata is None or metadata.archived_at is not None:
            return False
        if self._user_storage_space_role(user, access, bucket_name) != "Owner":
            return False
        return bool(
            self.get_effective_portal_settings(access.account).allow_portal_user_external_sharing
        )

    def _storage_space_share_card(
        self,
        actor: User,
        target: User,
        storage_space_id: str,
        storage_space_name: str,
        role: PortalStorageSpaceGrantRole,
    ) -> PortalStorageSpaceShare:
        return PortalStorageSpaceShare(
            id=f"{storage_space_id}:{target.id}",
            storage_space_id=storage_space_id,
            storage_space_name=storage_space_name,
            user_id=target.id,
            email=target.email,
            role=role,
            direction="with_me" if actor.id == target.id else "by_me",
            activity_label="Active",
        )

    def _validate_initial_storage_space_shares(
        self,
        access: "AccountAccess",
        *,
        visibility: PortalStorageSpaceVisibility,
        share_scope: PortalStorageSpaceShareScope,
        initial_shares: Optional[list[PortalStorageSpaceInitialShare]],
    ) -> list[PortalStorageSpaceInitialShare]:
        shares = initial_shares or []
        if not shares:
            return []
        if visibility != "shared" or share_scope != "restricted":
            raise PortalBadRequestError("Initial shares are allowed only for restricted shared Storage Spaces.")
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise PortalForbiddenError("Only project managers can configure team Storage Space access.")
        member_map = self._portal_account_member_map(access.account)
        seen_user_ids: set[int] = set()
        validated: list[PortalStorageSpaceInitialShare] = []
        for share in shares:
            if share.user_id in seen_user_ids:
                raise PortalBadRequestError("Duplicate initial share user.")
            member = member_map.get(share.user_id)
            if member is None or member[1] != PortalAccountRole.PORTAL_USER.value:
                raise PortalBadRequestError("Only Portal users can receive an explicit team Storage Space role.")
            seen_user_ids.add(share.user_id)
            validated.append(share)
        return validated

    def _add_storage_space_initial_grants(
        self,
        metadata: PortalStorageSpaceMetadata,
        user: User,
        initial_shares: list[PortalStorageSpaceInitialShare],
    ) -> None:
        for share in initial_shares:
            grant = self._storage_space_grant(metadata.id, share.user_id)
            if grant is None:
                grant = PortalStorageSpaceGrant(
                    storage_space_metadata_id=metadata.id,
                    user_id=share.user_id,
                    role=share.role,
                    created_by_user_id=user.id,
                )
            else:
                grant.role = share.role
                grant.updated_at = utcnow()
            self.db.add(grant)

    def _storage_space_owner_person(
        self,
        metadata: PortalStorageSpaceMetadata | None,
        account: S3Account,
    ) -> PortalStorageSpaceAccessPerson | None:
        if metadata is None or self._metadata_visibility(metadata) != "private":
            return None
        owner: User | None = None
        if metadata and metadata.owner_user_id is not None:
            owner = self.db.scalar(
                select(User).where(User.id == metadata.owner_user_id)
            )
        if owner is None:
            raise RuntimeError("Private Storage Space owner is missing.")
        member = self._portal_account_member_map(account).get(owner.id)
        return PortalStorageSpaceAccessPerson(
            user_id=owner.id,
            email=owner.email,
            display_name=owner.full_name,
            role="Owner",
            portal_role=member[1] if member else None,
            access_source="owner",
            avatar=UserAvatarService(self.db).descriptor(owner),
        )

    def _storage_space_effective_access_user_ids(self, metadata: PortalStorageSpaceMetadata) -> set[int]:
        if metadata.archived_at:
            return set()
        user_ids: set[int] = set()
        if metadata.owner_user_id is not None:
            user_ids.add(metadata.owner_user_id)
        account = self.db.scalar(
            select(S3Account).where(S3Account.id == metadata.account_id)
        )
        member_map = self._portal_account_member_map(account) if account is not None else {}
        if account is not None:
            user_ids.update(
                user_id
                for user_id, (_target, role, _sources) in member_map.items()
                if role == PortalAccountRole.PORTAL_MANAGER.value
            )
        if self._metadata_visibility(metadata) != "shared":
            return user_ids
        if self._metadata_share_scope(metadata) == "account":
            if account is not None:
                user_ids.update(
                    user_id
                    for user_id, (_target, role, _sources) in member_map.items()
                    if role == PortalAccountRole.PORTAL_USER.value
                )
            return user_ids
        grant_user_ids = self.db.scalars(
            select(PortalStorageSpaceGrant.user_id).where(
                PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id
            )
        ).all()
        user_ids.update(user_id for user_id in grant_user_ids if user_id is not None)
        return user_ids

    def get_storage_space_access_summary(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceAccessSummary:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id, include_archived=True)
        if not bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        metadata = self._storage_space_metadata(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        storage_space = next(
            (
                item
                for item in self.list_storage_spaces(user, access, include_archived=True)
                if item.id == space_id or item.internal_bucket_name == bucket_name
            ),
            None,
        )
        if storage_space is None:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        actor_role = self._user_storage_space_role(user, access, bucket_name, include_archived=True)
        can_manage_access = (
            actor_role == "Manager"
            and metadata.archived_at is None
            and self._metadata_visibility(metadata) == "shared"
        )
        mode = "private"
        if self._metadata_visibility(metadata) == "shared":
            mode = "all" if self._metadata_share_scope(metadata) == "account" else "restricted"
        explicit_share_rows = self.db.execute(
            select(PortalStorageSpaceGrant, User)
            .join(User, User.id == PortalStorageSpaceGrant.user_id)
            .where(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
        ).all()
        explicit_shares = [
            self._storage_space_share_card(
                user,
                target,
                storage_space.id,
                storage_space.name,
                grant.role,
            )
            for grant, target in explicit_share_rows
            if grant.role in {"Viewer", "Editor"}
        ]
        public_link_count = int(
            self.db.scalar(
                select(func.count())
                .select_from(DBPortalPublicLink)
                .where(
                    DBPortalPublicLink.account_id == access.account.id,
                    DBPortalPublicLink.bucket_name == bucket_name,
                    DBPortalPublicLink.revoked_at.is_(None),
                )
            )
            or 0
        )
        return PortalStorageSpaceAccessSummary(
            mode=mode,
            default_account_member_role=self._metadata_account_member_role(metadata),
            owner=self._storage_space_owner_person(metadata, access.account),
            effective_member_count=len(self._storage_space_effective_access_user_ids(metadata)),
            explicit_shares=sorted(explicit_shares, key=lambda item: item.email.lower()),
            public_link_count=public_link_count,
            can_manage_access=can_manage_access,
            can_create_public_links=bool(
                metadata.archived_at is None
                and (
                    can_manage_access
                    or self._portal_user_can_create_external_sharing(user, access, bucket_name)
                )
            ),
        )

    def _require_storage_space_manager(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        *,
        include_archived: bool = False,
    ) -> None:
        role = self._user_storage_space_role(user, access, bucket_name, include_archived=include_archived)
        if role not in {"Owner", "Manager"}:
            raise PortalForbiddenError("Full management access required for this storage space.")

    def _require_storage_space_full_content_access(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        *,
        include_archived: bool = False,
    ) -> None:
        if self._user_storage_space_role(
            user,
            access,
            bucket_name,
            include_archived=include_archived,
        ) not in {"Owner", "Manager"}:
            raise PortalForbiddenError("Full content access required for this storage space.")

    def _require_storage_space_active(self, account: S3Account, bucket_name: str) -> PortalStorageSpaceMetadata | None:
        metadata = self._storage_space_metadata(account, bucket_name)
        if metadata and metadata.archived_at:
            raise PortalConflictError("Storage space is archived.")
        return metadata

    def _require_storage_space_shared(self, account: S3Account, bucket_name: str) -> PortalStorageSpaceMetadata | None:
        metadata = self._require_storage_space_active(account, bucket_name)
        if self._metadata_visibility(metadata) == "private":
            raise PortalForbiddenError("Private storage spaces cannot be shared.")
        return metadata

    def list_storage_space_shares(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> list[PortalStorageSpaceShare]:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if self._metadata_visibility(metadata) != "shared":
            return []
        storage_space = next(
            (
                item
                for item in self.list_storage_spaces(user, access)
                if item.id == space_id or item.internal_bucket_name == bucket_name
            ),
            None,
        )
        if storage_space is None:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        actor_role = self._user_storage_space_role(user, access, bucket_name)
        can_see_all = actor_role == "Manager"
        shares: list[PortalStorageSpaceShare] = []
        if metadata is None:
            return shares
        query = (
            select(PortalStorageSpaceGrant, User)
            .join(User, User.id == PortalStorageSpaceGrant.user_id)
            .where(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
        )
        if not can_see_all:
            query = query.where(PortalStorageSpaceGrant.user_id == user.id)
        for grant, target in self.db.execute(query).all():
            if grant.role not in {"Viewer", "Editor"}:
                continue
            shares.append(
                self._storage_space_share_card(
                    user,
                    target,
                    storage_space.id,
                    storage_space.name,
                    grant.role,
                )
            )
        return sorted(shares, key=lambda item: (item.direction, item.email.lower()))

    def list_storage_space_share_candidates(
        self,
        user: User,
        access: "AccountAccess",
        space_id: Optional[str] = None,
        *,
        page: int = 1,
        page_size: int = 25,
        search: str | None = None,
        include_already_shared: bool = False,
    ) -> tuple[list[PortalStorageSpaceShareCandidate], int]:
        metadata: PortalStorageSpaceMetadata | None = None
        excluded_user_ids = {user.id}
        shared_user_ids: set[int] = set()
        if space_id:
            bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
            if not bucket_name:
                raise PortalNotFoundError("Storage space not found or not allowed.")
            self._require_storage_space_manager(user, access, bucket_name)
            metadata = self._require_storage_space_active(access.account, bucket_name)
            if metadata is None:
                raise RuntimeError("Storage space metadata is missing.")
            if metadata.owner_user_id is not None:
                excluded_user_ids.add(metadata.owner_user_id)
            shared_user_ids = set(
                self.db.scalars(
                    select(PortalStorageSpaceGrant.user_id).where(
                        PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id
                    )
                ).all()
            )
        direct_user = exists(
            select(UserS3Account.id).where(
                UserS3Account.user_id == User.id,
                UserS3Account.account_id == access.account.id,
                UserS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
            )
        )
        group_user = exists(
            select(UserUiGroup.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .where(
                UserUiGroup.user_id == User.id,
                UiGroupS3Account.account_id == access.account.id,
                UiGroupS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
            )
        )
        direct_manager = exists(
            select(UserS3Account.id).where(
                UserS3Account.user_id == User.id,
                UserS3Account.account_id == access.account.id,
                UserS3Account.portal_role == PortalAccountRole.PORTAL_MANAGER.value,
            )
        )
        group_manager = exists(
            select(UserUiGroup.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .where(
                UserUiGroup.user_id == User.id,
                UiGroupS3Account.account_id == access.account.id,
                UiGroupS3Account.portal_role == PortalAccountRole.PORTAL_MANAGER.value,
            )
        )
        statement = select(User).where(
            User.is_active.is_(True),
            or_(direct_user, group_user),
            ~or_(direct_manager, group_manager),
            ~User.id.in_(excluded_user_ids),
        )
        if shared_user_ids and not include_already_shared:
            statement = statement.where(~User.id.in_(shared_user_ids))
        search_value = (search or "").strip()
        if search_value:
            pattern = f"%{search_value}%"
            statement = statement.where(
                or_(User.email.ilike(pattern), func.coalesce(User.full_name, "").ilike(pattern))
            )
        targets, total = paginate_scalars(
            self.db,
            statement,
            order_by=(func.lower(User.email).asc(), User.id.asc()),
            page=page,
            page_size=page_size,
        )
        direct_ids = set(
            self.db.scalars(
                select(UserS3Account.user_id).where(
                    UserS3Account.account_id == access.account.id,
                    UserS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
                    UserS3Account.user_id.in_([target.id for target in targets] or [-1]),
                )
            ).all()
        )
        group_ids = set(
            self.db.scalars(
                select(UserUiGroup.user_id)
                .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
                .where(
                    UiGroupS3Account.account_id == access.account.id,
                    UiGroupS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
                    UserUiGroup.user_id.in_([target.id for target in targets] or [-1]),
                )
            ).all()
        )
        rows = [
            PortalStorageSpaceShareCandidate(
                user_id=target.id,
                email=target.email,
                display_name=target.full_name,
                portal_role=PortalAccountRole.PORTAL_USER.value,
                access_source=(
                    "direct_and_group"
                    if target.id in direct_ids and target.id in group_ids
                    else "direct"
                    if target.id in direct_ids
                    else "group"
                ),
                already_shared=target.id in shared_user_ids,
                avatar=None,
            )
            for target in targets
        ]
        return rows, total

    def set_storage_space_share(
        self,
        user: User,
        access: "AccountAccess",
        target: User,
        space_id: str,
        role: PortalStorageSpaceGrantRole,
    ) -> PortalStorageSpaceShare:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        metadata = self._require_storage_space_shared(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        portal_role = self._user_s3_account_portal_role(
            target.id,
            access.account.id,
        )
        if portal_role != PortalAccountRole.PORTAL_USER.value:
            raise PortalBadRequestError("Only Portal users can receive an explicit team Storage Space role.")
        grant = self._storage_space_grant(metadata.id, target.id)
        if grant is None:
            grant = PortalStorageSpaceGrant(
                storage_space_metadata_id=metadata.id,
                user_id=target.id,
                role=role,
                created_by_user_id=user.id,
            )
        else:
            grant.role = role
            grant.updated_at = utcnow()
        self.db.add(grant)
        try:
            self.db.flush()
            self._sync_storage_space_access_projection(access.account, metadata, extra_user_ids={target.id})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        shares = self.list_storage_space_shares(user, access, space_id)
        return next(
            (share for share in shares if share.user_id == target.id),
            self._storage_space_share_card(
                user,
                target,
                space_id,
                self._storage_space_label(bucket_name),
                role,
            ),
        )

    def revoke_storage_space_share(
        self,
        user: User,
        access: "AccountAccess",
        target: User,
        space_id: str,
    ) -> list[PortalStorageSpaceShare]:
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if metadata is None:
            raise RuntimeError("Storage space metadata is missing.")
        grant = self._storage_space_grant(metadata.id, target.id)
        try:
            if grant is not None:
                self.db.delete(grant)
                self.db.flush()
            if grant is not None:
                self._sync_storage_space_access_projection(access.account, metadata, extra_user_ids={target.id})
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return self.list_storage_space_shares(user, access, space_id)
