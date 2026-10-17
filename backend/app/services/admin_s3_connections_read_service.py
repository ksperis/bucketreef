# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import exists, func
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
    S3ConnectionGroupDetail,
    S3ConnectionSummary,
)
from app.models.user import UserAssociationDetail
from app.services.s3_connections_service import S3ConnectionsService
from app.services.tags_service import TagsService
from app.services.ui_group_avatar_service import UiGroupAvatarService
from app.services.user_avatar_service import UserAvatarService
from app.utils.name_ordering import name_order_by
from app.utils.s3_connection_capabilities import parse_s3_connection_capabilities
from app.utils.s3_connection_endpoint import resolve_connection_details


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
        rows = (
            self.db.query(UserS3Connection.s3_connection_id, User)
            .join(User, User.id == UserS3Connection.user_id)
            .filter(UserS3Connection.s3_connection_id.in_(connection_ids))
            .order_by(
                UserS3Connection.s3_connection_id.asc(),
                User.email.asc(),
                User.id.asc(),
            )
            .all()
        )
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
        rows = (
            self.db.query(UiGroupS3Connection.s3_connection_id, UiGroup)
            .join(UiGroup, UiGroup.id == UiGroupS3Connection.group_id)
            .filter(UiGroupS3Connection.s3_connection_id.in_(connection_ids))
            .order_by(
                UiGroupS3Connection.s3_connection_id.asc(),
                UiGroup.name.asc(),
                UiGroup.id.asc(),
            )
            .all()
        )
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
        capabilities = parse_s3_connection_capabilities(conn.capabilities_json)
        return S3ConnectionAdminItem(
            id=conn.id,
            name=conn.name,
            storage_endpoint_id=conn.storage_endpoint_id,
            endpoint_url=details.endpoint_url or "",
            is_active=bool(conn.is_active),
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

    def _query(self, *, search: Optional[str]):
        linked_user = aliased(User)
        query = (
            self.db.query(
                S3Connection,
                func.count(UserS3Connection.id).label("user_count"),
                func.max(User.email).label("created_by_email"),
            )
            .outerjoin(User, User.id == S3Connection.created_by_user_id)
            .outerjoin(StorageEndpoint, StorageEndpoint.id == S3Connection.storage_endpoint_id)
            .outerjoin(UserS3Connection, UserS3Connection.s3_connection_id == S3Connection.id)
            .outerjoin(linked_user, linked_user.id == UserS3Connection.user_id)
            .filter(*S3ConnectionsService.admin_shared_predicates())
            .group_by(S3Connection.id)
        )
        if not search:
            return query

        term = f"%{search.strip()}%"
        tag_match = (
            exists()
            .where(S3ConnectionTag.s3_connection_id == S3Connection.id)
            .where(TagDefinition.id == S3ConnectionTag.tag_definition_id)
            .where(TagDefinition.label.ilike(term))
        )
        group_match = (
            exists()
            .where(UiGroupS3Connection.s3_connection_id == S3Connection.id)
            .where(UiGroup.id == UiGroupS3Connection.group_id)
            .where(UiGroup.name.ilike(term))
        )
        return query.filter(
            (S3Connection.name.ilike(term))
            | (StorageEndpoint.endpoint_url.ilike(term))
            | (S3Connection.custom_endpoint_config.ilike(term))
            | (User.email.ilike(term))
            | (linked_user.email.ilike(term))
            | (linked_user.full_name.ilike(term))
            | group_match
            | tag_match
        )

    @staticmethod
    def _order(query, *, sort_by: str, sort_dir: str):
        sort_map = {
            "name": S3Connection.name,
            "endpoint": StorageEndpoint.endpoint_url,
            "owner": User.email,
            "last_used_at": S3Connection.last_used_at,
            "created_at": S3Connection.created_at,
        }
        requested_sort = sort_by if sort_by in sort_map else "name"
        descending = sort_dir.lower() == "desc"
        if requested_sort == "name":
            if descending:
                return query.order_by(
                    func.lower(S3Connection.name).desc(),
                    S3Connection.name.desc(),
                    S3Connection.id.desc(),
                )
            return query.order_by(*name_order_by(S3Connection))

        sort_field = sort_map[requested_sort]
        if descending:
            return query.order_by(sort_field.desc(), S3Connection.id.desc())
        return query.order_by(sort_field.asc(), S3Connection.id.asc())

    def _items(self, rows) -> list[S3ConnectionAdminItem]:
        connection_ids = [conn.id for conn, _, _ in rows]
        creator_ids = {int(conn.created_by_user_id) for conn, _, _ in rows}
        creators_by_id = (
            {
                int(creator.id): creator
                for creator in self.db.query(User).filter(User.id.in_(creator_ids)).all()
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
        *,
        page: int,
        page_size: int,
        search: Optional[str],
        sort_by: str,
        sort_dir: str,
    ) -> PaginatedS3ConnectionsResponse:
        query = self._order(
            self._query(search=search),
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
        total = query.count()
        rows = query.offset((page - 1) * page_size).limit(page_size).all()
        return PaginatedS3ConnectionsResponse(
            items=self._items(rows),
            total=total,
            page=page,
            page_size=page_size,
            has_next=page * page_size < total,
        )

    def list_minimal(self) -> list[S3ConnectionSummary]:
        rows = (
            self.db.query(
                S3Connection.id,
                S3Connection.name,
                S3Connection.created_by_user_id,
                S3Connection.is_active,
                S3Connection.remediation_required,
            )
            .filter(*S3ConnectionsService.admin_shared_predicates())
            .order_by(*name_order_by(S3Connection))
            .all()
        )
        return [
            S3ConnectionSummary(
                id=row[0],
                name=row[1],
                created_by_user_id=row[2],
                is_active=bool(row[3]),
                execution_status="remediation_required" if row[4] else "ready",
            )
            for row in rows
        ]

    def item(
        self,
        conn: S3Connection,
        *,
        created_by_user: User | None = None,
        include_links: bool = True,
    ) -> S3ConnectionAdminItem:
        creator = created_by_user
        if creator is None:
            creator = (
                self.db.query(User)
                .filter(User.id == conn.created_by_user_id)
                .first()
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
