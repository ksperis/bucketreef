# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session, aliased

from app.db import (
    S3Connection,
    S3ConnectionTag,
    StorageEndpoint,
    TagDefinition,
    UiGroup,
    UiGroupS3Connection,
    User,
    UserS3Connection,
)
from app.models.s3_connection_admin import (
    PaginatedS3ConnectionsResponse,
    S3ConnectionAdminItem,
    S3ConnectionAdminListingRequest,
    S3ConnectionGroupDetail,
)
from app.models.user import UserAssociationDetail
from app.services.s3_connections_service import S3ConnectionsService
from app.services.tags_service import TagsService
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.name_ordering import name_order_by
from app.utils.s3_connection_capabilities import validate_s3_connection_capabilities
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.sql_search import text_search_predicate


class AdminS3ConnectionsReadService:
    """Build Admin-safe shared-connection list and detail payloads."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)
        self.user_avatars = UserAvatarService(db)
        self.group_avatars = UiGroupAvatarService(db)

    def _linked_user_details_by_connection(
        self,
        connection_ids: list[int],
    ) -> dict[int, list[UserAssociationDetail]]:
        if not connection_ids:
            return {}
        rows = self.db.execute(
            select(UserS3Connection.s3_connection_id, User)
            .join(User, User.id == UserS3Connection.user_id)
            .where(UserS3Connection.s3_connection_id.in_(connection_ids))
            .order_by(
                UserS3Connection.s3_connection_id.asc(),
                User.email.asc(),
                User.id.asc(),
            )
        ).all()
        details: dict[int, list[UserAssociationDetail]] = {}
        for connection_id, user in rows:
            details.setdefault(int(connection_id), []).append(
                UserAssociationDetail(
                    id=int(user.id),
                    email=user.email,
                    full_name=user.full_name,
                    avatar=self.user_avatars.descriptor(user),
                )
            )
        return details

    def _linked_group_details_by_connection(
        self,
        connection_ids: list[int],
    ) -> dict[int, list[S3ConnectionGroupDetail]]:
        if not connection_ids:
            return {}
        rows = self.db.execute(
            select(UiGroupS3Connection.s3_connection_id, UiGroup)
            .join(UiGroup, UiGroup.id == UiGroupS3Connection.group_id)
            .where(UiGroupS3Connection.s3_connection_id.in_(connection_ids))
            .order_by(
                UiGroupS3Connection.s3_connection_id.asc(),
                UiGroup.name.asc(),
                UiGroup.id.asc(),
            )
        ).all()
        details: dict[int, list[S3ConnectionGroupDetail]] = {}
        for connection_id, group in rows:
            details.setdefault(int(connection_id), []).append(
                S3ConnectionGroupDetail(
                    id=int(group.id),
                    name=group.name,
                    avatar=self.group_avatars.descriptor(group),
                )
            )
        return details

    def _to_admin_item(
        self,
        conn: S3Connection,
        *,
        created_by_email: Optional[str],
        created_by_user: Optional[User],
        user_count: int,
        user_details: list[UserAssociationDetail],
        group_details: list[S3ConnectionGroupDetail],
    ) -> S3ConnectionAdminItem:
        details = resolve_connection_details(conn)
        capabilities = validate_s3_connection_capabilities(conn.capabilities)
        return S3ConnectionAdminItem(
            id=conn.id,
            name=conn.name,
            storage_endpoint_id=conn.storage_endpoint_id,
            endpoint_url=details.endpoint_url or "",
            is_active=conn.is_active,
            execution_status="remediation_required" if conn.remediation_required else "ready",
            remediation_reason=conn.remediation_reason,
            rgw_user_uid=conn.rgw_user_uid,
            rgw_tenant=conn.rgw_tenant,
            rgw_account_id=conn.rgw_account_id,
            provider_hint=details.provider,
            region=details.region,
            force_path_style=details.force_path_style,
            verify_tls=details.verify_tls,
            allow_activity_history=conn.allow_activity_history,
            created_by_user_id=conn.created_by_user_id,
            created_by_email=created_by_email,
            created_by_full_name=created_by_user.full_name if created_by_user else None,
            created_by_avatar=(
                self.user_avatars.descriptor(created_by_user)
                if created_by_user
                else None
            ),
            user_count=int(user_count),
            user_details=user_details,
            group_details=group_details,
            tags=self.tags.get_connection_tags(conn),
            last_used_at=conn.last_used_at,
            created_at=conn.created_at,
            updated_at=conn.updated_at,
            capabilities=capabilities,
        )

    def _select(self, *, search: Optional[str], search_exact: bool):
        linked_user = aliased(User)
        statement = (
            select(
                S3Connection,
                func.count(UserS3Connection.id).label("user_count"),
                func.max(User.email).label("created_by_email"),
            )
            .outerjoin(User, User.id == S3Connection.created_by_user_id)
            .outerjoin(StorageEndpoint, StorageEndpoint.id == S3Connection.storage_endpoint_id)
            .outerjoin(UserS3Connection, UserS3Connection.s3_connection_id == S3Connection.id)
            .outerjoin(linked_user, linked_user.id == UserS3Connection.user_id)
            .where(*S3ConnectionsService.admin_shared_predicates())
            .group_by(S3Connection.id)
        )
        if not search:
            return statement

        search_value = search.strip()
        tag_match = (
            exists()
            .where(S3ConnectionTag.s3_connection_id == S3Connection.id)
            .where(TagDefinition.id == S3ConnectionTag.tag_definition_id)
            .where(text_search_predicate(TagDefinition.label, search_value, exact=search_exact))
        )
        group_match = (
            exists()
            .where(UiGroupS3Connection.s3_connection_id == S3Connection.id)
            .where(UiGroup.id == UiGroupS3Connection.group_id)
            .where(text_search_predicate(UiGroup.name, search_value, exact=search_exact))
        )
        return statement.where(
            text_search_predicate(S3Connection.name, search_value, exact=search_exact)
            | text_search_predicate(StorageEndpoint.endpoint_url, search_value, exact=search_exact)
            | text_search_predicate(S3Connection.custom_endpoint_url, search_value, exact=search_exact)
            | text_search_predicate(User.email, search_value, exact=search_exact)
            | text_search_predicate(linked_user.email, search_value, exact=search_exact)
            | text_search_predicate(linked_user.full_name, search_value, exact=search_exact)
            | group_match
            | tag_match
        )

    @staticmethod
    def _order(query, request: S3ConnectionAdminListingRequest):
        sort_map = {
            "name": S3Connection.name,
            "endpoint": StorageEndpoint.endpoint_url,
            "owner": User.email,
            "last_used_at": S3Connection.last_used_at,
            "created_at": S3Connection.created_at,
        }
        descending = request.sort_dir == "desc"
        if request.sort_by == "name":
            return query.order_by(*name_order_by(S3Connection, descending=descending))

        sort_field = sort_map[request.sort_by]
        if descending:
            return query.order_by(sort_field.desc(), S3Connection.id.desc())
        return query.order_by(sort_field.asc(), S3Connection.id.asc())

    def _items(self, rows) -> list[S3ConnectionAdminItem]:
        connection_ids = [conn.id for conn, _, _ in rows]
        creator_ids = {int(conn.created_by_user_id) for conn, _, _ in rows}
        creators_by_id = (
            {
                int(creator.id): creator
                for creator in self.db.scalars(
                    select(User).where(User.id.in_(creator_ids))
                ).all()
            }
            if creator_ids
            else {}
        )
        users_by_connection = self._linked_user_details_by_connection(connection_ids)
        groups_by_connection = self._linked_group_details_by_connection(connection_ids)
        return [
            self._to_admin_item(
                conn,
                created_by_email=created_by_email,
                created_by_user=creators_by_id.get(int(conn.created_by_user_id)),
                user_count=int(user_count or 0),
                user_details=users_by_connection.get(conn.id, []),
                group_details=groups_by_connection.get(conn.id, []),
            )
            for conn, user_count, created_by_email in rows
        ]

    def list(
        self,
        request: S3ConnectionAdminListingRequest,
    ) -> PaginatedS3ConnectionsResponse:
        statement = self._order(
            self._select(
                search=request.search,
                search_exact=request.search_exact,
            ),
            request,
        )
        total = int(
            self.db.scalar(
                select(func.count()).select_from(statement.order_by(None).subquery())
            )
            or 0
        )
        rows = self.db.execute(
            statement.offset((request.page - 1) * request.page_size).limit(
                request.page_size
            )
        ).all()
        return PaginatedS3ConnectionsResponse(
            items=self._items(rows),
            total=total,
            page=request.page,
            page_size=request.page_size,
            has_next=request.page * request.page_size < total,
        )

    def item(
        self,
        conn: S3Connection,
        *,
        created_by_user: User | None = None,
        include_links: bool = True,
    ) -> S3ConnectionAdminItem:
        creator = created_by_user
        if creator is None:
            creator = self.db.scalar(
                select(User)
                .where(User.id == conn.created_by_user_id)
                .limit(1)
            )
        if include_links:
            user_details = self._linked_user_details_by_connection([conn.id]).get(conn.id, [])
            group_details = self._linked_group_details_by_connection([conn.id]).get(conn.id, [])
        else:
            user_details = []
            group_details = []
        return self._to_admin_item(
            conn,
            created_by_email=creator.email if creator else None,
            created_by_user=creator,
            user_count=len(user_details),
            user_details=user_details,
            group_details=group_details,
        )
