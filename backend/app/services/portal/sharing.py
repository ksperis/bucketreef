# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Optional

from sqlalchemy import exists, func, or_, select

from app.core.db_transactions import run_replayable_db_unit
from app.db import (
    PortalPublicLink as DBPortalPublicLink,
    PortalStorageSpaceGrant,
    PortalStorageSpaceMetadata,
    S3Account,
    UiGroupS3Account,
    User,
    UserS3Account,
    UserUiGroup,
)
from app.core.domain_enums import PortalAccountRole
from app.models.portal_storage_spaces import (
    PortalStorageSpaceGrantRole,
    PortalStorageSpaceInitialShare,
    PortalStorageSpaceShareScope,
    PortalStorageSpaceVisibility,
)
from app.models.portal_sharing import (
    PaginatedPortalStorageSpaceShareCandidates,
    PortalShareCandidateListingRequest,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceOwner,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
)
from app.services.portal.exceptions import (
    PortalBadRequestError,
    PortalConflictError,
    PortalForbiddenError,
    PortalNotFoundError,
    PortalOperationError,
)
from app.services.sqlalchemy_pagination import paginate_scalars
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.services.access_context_contracts import AccountAccess


logger = logging.getLogger(__name__)


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
        target: User,
        role: PortalStorageSpaceGrantRole,
    ) -> PortalStorageSpaceShare:
        return PortalStorageSpaceShare(
            user_id=target.id,
            email=target.email,
            role=role,
        )

    def _validate_initial_storage_space_shares(
        self,
        access: "AccountAccess",
        *,
        visibility: PortalStorageSpaceVisibility,
        share_scope: PortalStorageSpaceShareScope,
        initial_shares: list[PortalStorageSpaceInitialShare],
    ) -> list[PortalStorageSpaceInitialShare]:
        if not initial_shares:
            return []
        if visibility != "shared" or share_scope != "restricted":
            raise PortalBadRequestError("Initial shares are allowed only for restricted shared Storage Spaces.")
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise PortalForbiddenError("Only project managers can configure team Storage Space access.")
        member_map = self._portal_account_member_map(access.account)
        seen_user_ids: set[int] = set()
        validated: list[PortalStorageSpaceInitialShare] = []
        for share in initial_shares:
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

    def _storage_space_owner_card(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> PortalStorageSpaceOwner | None:
        if metadata is None or self._metadata_visibility(metadata) != "private":
            return None
        owner: User | None = None
        if metadata and metadata.owner_user_id is not None:
            owner = self.db.scalar(
                select(User).where(User.id == metadata.owner_user_id)
            )
        if owner is None:
            raise PortalOperationError("Private Storage Space owner is missing.")
        return PortalStorageSpaceOwner(
            email=owner.email,
            display_name=owner.full_name,
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

    def _storage_space_access_mode(
        self,
        metadata: PortalStorageSpaceMetadata,
    ) -> str:
        if self._metadata_visibility(metadata) != "shared":
            return "private"
        return "all" if self._metadata_share_scope(metadata) == "account" else "restricted"

    def _storage_space_explicit_shares(
        self,
        metadata: PortalStorageSpaceMetadata,
    ) -> list[PortalStorageSpaceShare]:
        rows = self.db.execute(
            select(PortalStorageSpaceGrant, User)
            .join(User, User.id == PortalStorageSpaceGrant.user_id)
            .where(PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id)
        ).all()
        shares = [
            self._storage_space_share_card(
                target,
                grant.role,
            )
            for grant, target in rows
            if grant.role in {"Viewer", "Editor"}
        ]
        return sorted(shares, key=lambda item: item.email.lower())

    def _storage_space_public_link_count(
        self,
        account_id: int,
        bucket_name: str,
    ) -> int:
        return int(
            self.db.scalar(
                select(func.count())
                .select_from(DBPortalPublicLink)
                .where(
                    DBPortalPublicLink.account_id == account_id,
                    DBPortalPublicLink.bucket_name == bucket_name,
                    DBPortalPublicLink.revoked_at.is_(None),
                )
            )
            or 0
        )

    def get_storage_space_access_summary(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceAccessSummary:
        storage_space = self._visible_storage_space_summary(
            user,
            access,
            space_id,
            include_archived=True,
        )
        if storage_space is None or not storage_space.internal_bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        bucket_name = storage_space.internal_bucket_name
        metadata = self._storage_space_metadata(access.account, bucket_name)
        if metadata is None:
            raise PortalOperationError("Storage space metadata is missing.")
        actor_role = self._user_storage_space_role(user, access, bucket_name, include_archived=True)
        can_manage_access = (
            actor_role == "Manager"
            and metadata.archived_at is None
            and self._metadata_visibility(metadata) == "shared"
        )
        explicit_shares = self._storage_space_explicit_shares(
            metadata,
        )
        return PortalStorageSpaceAccessSummary(
            mode=self._storage_space_access_mode(metadata),
            default_account_member_role=self._metadata_account_member_role(metadata),
            owner=self._storage_space_owner_card(metadata),
            effective_member_count=len(self._storage_space_effective_access_user_ids(metadata)),
            explicit_shares=explicit_shares,
            public_link_count=self._storage_space_public_link_count(
                access.account.id,
                bucket_name,
            ),
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
        storage_space = self._visible_storage_space_summary(user, access, space_id)
        if storage_space is None or not storage_space.internal_bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        bucket_name = storage_space.internal_bucket_name
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if self._metadata_visibility(metadata) != "shared":
            return []
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
                    target,
                    grant.role,
                )
            )
        return sorted(shares, key=lambda item: item.email.lower())

    def list_storage_space_share_candidates(
        self,
        user: User,
        access: "AccountAccess",
        request: PortalShareCandidateListingRequest,
        *,
        space_id: Optional[str] = None,
    ) -> PaginatedPortalStorageSpaceShareCandidates:
        excluded_user_ids, shared_user_ids = self._storage_space_share_candidate_scope(
            user,
            access,
            space_id,
        )
        statement = self._storage_space_share_candidate_statement(
            account_id=access.account.id,
            excluded_user_ids=excluded_user_ids,
            shared_user_ids=shared_user_ids,
            include_already_shared=request.include_already_shared,
            search=request.search,
        )
        targets, total, has_next = paginate_scalars(
            self.db,
            statement,
            order_by=(func.lower(User.email).asc(), User.id.asc()),
            page=request.page,
            page_size=request.page_size,
        )
        direct_ids, group_ids = self._storage_space_share_candidate_access_sources(
            access.account.id,
            targets,
        )
        items = [
            PortalStorageSpaceShareCandidate(
                user_id=target.id,
                email=target.email,
                display_name=target.full_name,
                access_source=self._storage_space_share_candidate_source(
                    target.id,
                    direct_ids,
                    group_ids,
                ),
                already_shared=target.id in shared_user_ids,
            )
            for target in targets
        ]
        return PaginatedPortalStorageSpaceShareCandidates(
            items=items,
            total=total,
            page=request.page,
            page_size=request.page_size,
            has_next=has_next,
        )

    def _storage_space_share_candidate_scope(
        self,
        user: User,
        access: "AccountAccess",
        space_id: Optional[str],
    ) -> tuple[set[int], set[int]]:
        excluded_user_ids = {user.id}
        shared_user_ids: set[int] = set()
        if not space_id:
            return excluded_user_ids, shared_user_ids
        bucket_name = self._resolve_storage_space_bucket_name(user, access, space_id)
        if not bucket_name:
            raise PortalNotFoundError("Storage space not found or not allowed.")
        self._require_storage_space_manager(user, access, bucket_name)
        metadata = self._require_storage_space_active(access.account, bucket_name)
        if metadata is None:
            raise PortalOperationError("Storage space metadata is missing.")
        if metadata.owner_user_id is not None:
            excluded_user_ids.add(metadata.owner_user_id)
        shared_user_ids = set(
            self.db.scalars(
                select(PortalStorageSpaceGrant.user_id).where(
                    PortalStorageSpaceGrant.storage_space_metadata_id == metadata.id
                )
            ).all()
        )
        return excluded_user_ids, shared_user_ids

    def _storage_space_share_candidate_statement(
        self,
        *,
        account_id: int,
        excluded_user_ids: set[int],
        shared_user_ids: set[int],
        include_already_shared: bool,
        search: str | None,
    ):
        direct_user = exists(
            select(UserS3Account.id).where(
                UserS3Account.user_id == User.id,
                UserS3Account.account_id == account_id,
                UserS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
            )
        )
        group_user = exists(
            select(UserUiGroup.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .where(
                UserUiGroup.user_id == User.id,
                UiGroupS3Account.account_id == account_id,
                UiGroupS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
            )
        )
        direct_manager = exists(
            select(UserS3Account.id).where(
                UserS3Account.user_id == User.id,
                UserS3Account.account_id == account_id,
                UserS3Account.portal_role == PortalAccountRole.PORTAL_MANAGER.value,
            )
        )
        group_manager = exists(
            select(UserUiGroup.id)
            .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
            .where(
                UserUiGroup.user_id == User.id,
                UiGroupS3Account.account_id == account_id,
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
        return statement

    def _storage_space_share_candidate_access_sources(
        self,
        account_id: int,
        targets: list[User],
    ) -> tuple[set[int], set[int]]:
        target_ids = [target.id for target in targets] or [-1]
        direct_ids = set(
            self.db.scalars(
                select(UserS3Account.user_id).where(
                    UserS3Account.account_id == account_id,
                    UserS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
                    UserS3Account.user_id.in_(target_ids),
                )
            ).all()
        )
        group_ids = set(
            self.db.scalars(
                select(UserUiGroup.user_id)
                .join(UiGroupS3Account, UiGroupS3Account.group_id == UserUiGroup.group_id)
                .where(
                    UiGroupS3Account.account_id == account_id,
                    UiGroupS3Account.portal_role == PortalAccountRole.PORTAL_USER.value,
                    UserUiGroup.user_id.in_(target_ids),
                )
            ).all()
        )
        return direct_ids, group_ids

    @staticmethod
    def _storage_space_share_candidate_source(
        user_id: int,
        direct_ids: set[int],
        group_ids: set[int],
    ) -> str:
        if user_id in direct_ids and user_id in group_ids:
            return "direct_and_group"
        if user_id in direct_ids:
            return "direct"
        return "group"

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
            raise PortalOperationError("Storage space metadata is missing.")
        portal_role = self._user_s3_account_portal_role(
            target.id,
            access.account.id,
        )
        if portal_role != PortalAccountRole.PORTAL_USER.value:
            raise PortalBadRequestError("Only Portal users can receive an explicit team Storage Space role.")
        grant = self._storage_space_grant(metadata.id, target.id)
        account_id = access.account.id
        metadata_id = metadata.id
        target_id = target.id
        actor_id = user.id
        changed_at = utcnow()
        previous_grant = (
            None
            if grant is None
            else (
                grant.id,
                grant.role,
                grant.created_by_user_id,
                grant.created_at,
                grant.updated_at,
            )
        )

        def persist_grant(write_db):
            current_metadata = write_db.get(PortalStorageSpaceMetadata, metadata_id)
            if (
                current_metadata is None
                or current_metadata.account_id != account_id
                or current_metadata.bucket_name != bucket_name
                or current_metadata.archived_at is not None
                or self._metadata_visibility(current_metadata) != "shared"
            ):
                raise PortalConflictError("Storage space access changed. Refresh and retry.")
            current_grant = write_db.scalar(
                select(PortalStorageSpaceGrant).where(
                    PortalStorageSpaceGrant.storage_space_metadata_id == metadata_id,
                    PortalStorageSpaceGrant.user_id == target_id,
                )
            )
            if previous_grant is None:
                if current_grant is not None:
                    raise PortalConflictError("Storage space share changed. Refresh and retry.")
                current_grant = PortalStorageSpaceGrant(
                    storage_space_metadata_id=metadata_id,
                    user_id=target_id,
                    role=role,
                    created_by_user_id=actor_id,
                    created_at=changed_at,
                    updated_at=changed_at,
                )
                write_db.add(current_grant)
            else:
                previous_id, previous_role, _creator_id, _created_at, previous_updated_at = previous_grant
                if (
                    current_grant is None
                    or current_grant.id != previous_id
                    or current_grant.role != previous_role
                    or current_grant.updated_at != previous_updated_at
                ):
                    raise PortalConflictError("Storage space share changed. Refresh and retry.")
                current_grant.role = role
                current_grant.updated_at = changed_at
            write_db.flush()
            return current_grant.id

        persisted_grant_id = run_replayable_db_unit(self.db, persist_grant)
        account = self.db.get(S3Account, account_id)
        metadata = self.db.get(PortalStorageSpaceMetadata, metadata_id)
        if account is None or metadata is None:
            raise PortalOperationError("Storage space metadata is missing.")
        try:
            self._sync_storage_space_access_projection(account, metadata, extra_user_ids={target_id})
        except Exception as exc:
            rollback_error = None

            def restore_grant(write_db):
                current_grant = write_db.scalar(
                    select(PortalStorageSpaceGrant).where(
                        PortalStorageSpaceGrant.storage_space_metadata_id == metadata_id,
                        PortalStorageSpaceGrant.user_id == target_id,
                    )
                )
                if (
                    current_grant is None
                    or current_grant.id != persisted_grant_id
                    or current_grant.role != role
                    or current_grant.updated_at != changed_at
                ):
                    raise PortalConflictError("Storage space share changed during projection rollback.")
                if previous_grant is None:
                    write_db.delete(current_grant)
                    return
                _, previous_role, creator_id, created_at, updated_at = previous_grant
                current_grant.role = previous_role
                current_grant.created_by_user_id = creator_id
                current_grant.created_at = created_at
                current_grant.updated_at = updated_at

            try:
                run_replayable_db_unit(self.db, restore_grant)
            except Exception as compensation_exc:  # pragma: no cover - defensive database failure
                rollback_error = compensation_exc
                logger.error(
                    "Unable to roll back failed Storage Space share update: %s",
                    rollback_error,
                )
            projection_rollback_failed = False
            if rollback_error is None:
                account = self.db.get(S3Account, account_id)
                metadata = self.db.get(PortalStorageSpaceMetadata, metadata_id)
                if account is None or metadata is None:
                    projection_rollback_failed = True
                else:
                    projection_rollback_failed = self._restore_storage_space_access_projection(
                        account,
                        metadata,
                        extra_user_ids={target_id},
                    )
            if rollback_error is not None or projection_rollback_failed:
                raise PortalOperationError(
                    "Unable to update Storage Space share. Local or remote rollback also failed."
                ) from exc
            raise
        shares = self.list_storage_space_shares(user, access, space_id)
        return next(
            (share for share in shares if share.user_id == target.id),
            self._storage_space_share_card(
                target,
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
            raise PortalOperationError("Storage space metadata is missing.")
        grant = self._storage_space_grant(metadata.id, target.id)
        if grant is None:
            return self.list_storage_space_shares(user, access, space_id)
        account_id = access.account.id
        metadata_id = metadata.id
        target_id = target.id
        previous_grant = (
            grant.id,
            grant.role,
            grant.created_by_user_id,
            grant.created_at,
            grant.updated_at,
        )

        def delete_grant(write_db):
            current_metadata = write_db.get(PortalStorageSpaceMetadata, metadata_id)
            if (
                current_metadata is None
                or current_metadata.account_id != account_id
                or current_metadata.bucket_name != bucket_name
                or current_metadata.archived_at is not None
            ):
                raise PortalConflictError("Storage space access changed. Refresh and retry.")
            current_grant = write_db.scalar(
                select(PortalStorageSpaceGrant).where(
                    PortalStorageSpaceGrant.storage_space_metadata_id == metadata_id,
                    PortalStorageSpaceGrant.user_id == target_id,
                )
            )
            previous_id, previous_role, _creator_id, _created_at, previous_updated_at = previous_grant
            if (
                current_grant is None
                or current_grant.id != previous_id
                or current_grant.role != previous_role
                or current_grant.updated_at != previous_updated_at
            ):
                raise PortalConflictError("Storage space share changed. Refresh and retry.")
            write_db.delete(current_grant)

        run_replayable_db_unit(self.db, delete_grant)
        account = self.db.get(S3Account, account_id)
        metadata = self.db.get(PortalStorageSpaceMetadata, metadata_id)
        if account is None or metadata is None:
            raise PortalOperationError("Storage space metadata is missing.")
        try:
            self._sync_storage_space_access_projection(account, metadata, extra_user_ids={target_id})
        except Exception as exc:
            rollback_error = None

            def restore_grant(write_db):
                current_grant = write_db.scalar(
                    select(PortalStorageSpaceGrant).where(
                        PortalStorageSpaceGrant.storage_space_metadata_id == metadata_id,
                        PortalStorageSpaceGrant.user_id == target_id,
                    )
                )
                if current_grant is not None:
                    raise PortalConflictError("Storage space share changed during projection rollback.")
                grant_id, grant_role, creator_id, created_at, updated_at = previous_grant
                write_db.add(
                    PortalStorageSpaceGrant(
                        id=grant_id,
                        storage_space_metadata_id=metadata_id,
                        user_id=target_id,
                        role=grant_role,
                        created_by_user_id=creator_id,
                        created_at=created_at,
                        updated_at=updated_at,
                    )
                )

            try:
                run_replayable_db_unit(self.db, restore_grant)
            except Exception as compensation_exc:  # pragma: no cover - defensive database failure
                rollback_error = compensation_exc
                logger.error(
                    "Unable to roll back failed Storage Space share revocation: %s",
                    rollback_error,
                )
            projection_rollback_failed = False
            if rollback_error is None:
                account = self.db.get(S3Account, account_id)
                metadata = self.db.get(PortalStorageSpaceMetadata, metadata_id)
                if account is None or metadata is None:
                    projection_rollback_failed = True
                else:
                    projection_rollback_failed = self._restore_storage_space_access_projection(
                        account,
                        metadata,
                        extra_user_ids={target_id},
                    )
            if rollback_error is not None or projection_rollback_failed:
                raise PortalOperationError(
                    "Unable to revoke Storage Space share. Local or remote rollback also failed."
                ) from exc
            raise
        return self.list_storage_space_shares(user, access, space_id)
