# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session

from app.db import (
    S3User as S3UserModel,
    S3UserTag,
    TagDefinition,
    UiGroup,
    UiGroupS3User,
    User,
    UserS3User as UserS3UserModel,
)
from app.models.s3_user import (
    S3User as S3UserSchema,
    S3UserGroupLink,
    S3UserSummary,
    S3UserUserLink,
)
from app.services.mappers.s3_user import s3_user_from_db, s3_user_summary_from_db
from app.services.rgw_admin import RGWAdminClient
from app.services.s3_user_associations_service import S3UserAssociationsService
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.sqlalchemy_pagination import paginate_scalars
from app.services.tags_service import TagsService
from app.utils.name_ordering import name_order_by
from app.utils.sql_search import text_search_predicate


class S3UserQueryService:
    """Read, search, and serialize managed S3 users."""

    def __init__(
        self,
        db: Session,
        *,
        rgw_context: S3UserRgwContextService | None = None,
        metrics: S3UserMetricsService | None = None,
        repository: S3UserRepository | None = None,
        associations: S3UserAssociationsService | None = None,
        tags: TagsService | None = None,
    ) -> None:
        self.db = db
        self.rgw_context = rgw_context or S3UserRgwContextService(db)
        self.metrics = metrics or S3UserMetricsService()
        self.repository = repository or S3UserRepository(db)
        self.associations = associations or S3UserAssociationsService(db)
        self.tags = tags or TagsService(db)

    def get_user_record(self, user_id: int) -> S3UserModel:
        return self.repository.get(user_id)

    def serialize_user(
        self,
        row: S3UserModel,
        user_links_map: dict[int, list[S3UserUserLink]],
        group_links_map: dict[int, list[S3UserGroupLink]],
        *,
        include_quota: bool = True,
        quota_admin: RGWAdminClient | None = None,
        bucket_count: int | None = None,
    ) -> S3UserSchema:
        endpoint = self.rgw_context.endpoint_for_user(row)
        quota_max_size_gb = None
        quota_max_objects = None
        if include_quota:
            quota_max_size_gb, quota_max_objects = self.metrics.get_quota(
                row,
                quota_admin,
            )
        return s3_user_from_db(
            row,
            user_links=user_links_map.get(row.id, []),
            group_links=group_links_map.get(row.id, []),
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            storage_endpoint=endpoint,
            bucket_count=bucket_count,
            tags=self.tags.get_s3_user_tags(row),
        )

    def list_users(self, include_quota: bool = False) -> list[S3UserSchema]:
        rows = self.db.scalars(
            select(S3UserModel).order_by(*name_order_by(S3UserModel))
        ).all()
        s3_user_ids = [row.id for row in rows]
        user_links_map, group_links_map = self.associations.load_links(s3_user_ids)
        return [
            self.serialize_user(
                row,
                user_links_map,
                group_links_map,
                include_quota=include_quota,
            )
            for row in rows
        ]

    def list_users_minimal(self) -> list[S3UserSummary]:
        rows = self.db.scalars(
            select(S3UserModel).order_by(*name_order_by(S3UserModel))
        ).all()
        summaries: list[S3UserSummary] = []
        for row in rows:
            endpoint = self.rgw_context.endpoint_for_user(row)
            summaries.append(
                s3_user_summary_from_db(
                    row,
                    storage_endpoint=endpoint,
                    tags=self.tags.get_s3_user_tags(row),
                )
            )
        return summaries

    @staticmethod
    def _apply_user_search(query, search_value: str, *, exact: bool):
        if not search_value:
            return query
        tag_match = (
            exists()
            .where(S3UserTag.s3_user_id == S3UserModel.id)
            .where(TagDefinition.id == S3UserTag.tag_definition_id)
            .where(text_search_predicate(TagDefinition.label, search_value, exact=exact))
        )
        return (
            query.outerjoin(UserS3UserModel, S3UserModel.id == UserS3UserModel.s3_user_id)
            .outerjoin(User, UserS3UserModel.user_id == User.id)
            .outerjoin(UiGroupS3User, S3UserModel.id == UiGroupS3User.s3_user_id)
            .outerjoin(UiGroup, UiGroupS3User.group_id == UiGroup.id)
            .where(
                or_(
                    text_search_predicate(S3UserModel.name, search_value, exact=exact),
                    text_search_predicate(S3UserModel.rgw_user_uid, search_value, exact=exact),
                    text_search_predicate(S3UserModel.email, search_value, exact=exact),
                    text_search_predicate(User.email, search_value, exact=exact),
                    text_search_predicate(User.full_name, search_value, exact=exact),
                    text_search_predicate(UiGroup.name, search_value, exact=exact),
                    tag_match,
                )
            )
            .distinct()
        )

    @staticmethod
    def _user_order_columns(sort_field: str, sort_direction: str) -> list[Any]:
        sort_map = {
            "name": S3UserModel.name,
            "uid": S3UserModel.rgw_user_uid,
            "email": S3UserModel.email,
            "created_at": S3UserModel.created_at,
        }
        requested_sort = sort_field if sort_field in sort_map else "name"
        descending = sort_direction.lower() == "desc"
        if requested_sort == "name":
            return list(name_order_by(S3UserModel, descending=descending))
        sort_column = sort_map[requested_sort]
        direction = sort_column.desc if descending else sort_column.asc
        id_direction = S3UserModel.id.desc if descending else S3UserModel.id.asc
        return [direction(), id_direction()]

    def paginate_users(
        self,
        page: int,
        page_size: int,
        search: Optional[str] = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
        include_quota: bool = False,
        search_exact: bool = False,
    ) -> tuple[list[S3UserSchema], int]:
        search_value = search.strip() if isinstance(search, str) else ""
        query = self._apply_user_search(select(S3UserModel), search_value, exact=search_exact)
        rows, total = paginate_scalars(
            self.db,
            query,
            order_by=self._user_order_columns(sort_field, sort_direction),
            page=page,
            page_size=page_size,
        )
        s3_user_ids = [row.id for row in rows]
        user_links_map, group_links_map = self.associations.load_links(s3_user_ids)
        return [
            self.serialize_user(
                row,
                user_links_map,
                group_links_map,
                include_quota=include_quota,
            )
            for row in rows
        ], total

    def get_user(
        self,
        user_id: int,
        include_buckets: bool = False,
        include_quota: bool = False,
    ) -> S3UserSchema:
        s3_user = self.get_user_record(user_id)
        user_links_map, group_links_map = self.associations.load_links([s3_user.id])
        bucket_count = self.metrics.get_interface_bucket_count(s3_user) if include_buckets else None
        return self.serialize_user(
            s3_user,
            user_links_map,
            group_links_map,
            include_quota=include_quota,
            bucket_count=bucket_count,
        )
