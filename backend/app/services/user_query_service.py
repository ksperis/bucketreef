# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased
from sqlalchemy.sql import Select

from app.db import (
    S3Account,
    S3Connection,
    S3User,
    UiGroup,
    User,
    UserS3Account,
    UserS3Connection,
    UserS3User,
    UserUiGroup,
)
from app.models.admin_listing import AdminOptionListingRequest
from app.models.user import PaginatedUserSummariesResponse, UserOut, UserSummary
from app.services.sqlalchemy_pagination import paginate_scalars
from app.services.user_avatar_service import UserAvatarService
from app.services.user_output_service import UserOutputService
from app.utils.normalize import normalize_optional_email


class UserQueryService:
    """Read and project UI users for Admin listings."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def get_by_email(self, email: str) -> User | None:
        return self.db.scalar(select(User).where(User.email == email).limit(1))

    def get_by_email_case_insensitive(self, email: str) -> User | None:
        normalized = normalize_optional_email(email)
        if not normalized:
            return None
        return self.db.scalar(
            select(User).where(func.lower(User.email) == normalized).limit(1)
        )

    def get_by_id(self, user_id: int) -> User | None:
        return self.db.get(User, user_id)

    def list_users(self) -> list[User]:
        return list(self.db.scalars(select(User)).all())

    def list_user_options_page(
        self,
        request: AdminOptionListingRequest,
    ) -> PaginatedUserSummariesResponse:
        search_value = request.search.strip() if isinstance(request.search, str) else ""
        statement = select(User)
        if search_value:
            pattern = f"%{search_value}%"
            statement = statement.where(
                or_(
                    User.email.ilike(pattern),
                    func.coalesce(User.full_name, "").ilike(pattern),
                )
            )
        rows, total = paginate_scalars(
            self.db,
            statement,
            order_by=(func.lower(User.email).asc(), User.id.asc()),
            page=request.page,
            page_size=request.page_size,
        )
        avatar_service = UserAvatarService(self.db)
        items = [
            UserSummary(
                id=row.id,
                email=row.email,
                full_name=row.full_name,
                avatar=avatar_service.descriptor(row),
                role=row.role,
            )
            for row in rows
        ]
        return PaginatedUserSummariesResponse(
            items=items,
            total=total,
            page=request.page,
            page_size=request.page_size,
            has_next=request.page * request.page_size < total,
        )

    @staticmethod
    def _apply_search(
        statement: Select[tuple[User]],
        search_value: str,
    ) -> Select[tuple[User]]:
        if not search_value:
            return statement

        linked_connection = aliased(S3Connection)
        pattern = f"%{search_value}%"
        return (
            statement.outerjoin(UserS3Account, User.id == UserS3Account.user_id)
            .outerjoin(S3Account, UserS3Account.account_id == S3Account.id)
            .outerjoin(UserS3User, User.id == UserS3User.user_id)
            .outerjoin(S3User, UserS3User.s3_user_id == S3User.id)
            .outerjoin(UserS3Connection, User.id == UserS3Connection.user_id)
            .outerjoin(
                linked_connection,
                and_(
                    UserS3Connection.s3_connection_id == linked_connection.id,
                    linked_connection.is_shared.is_(True),
                ),
            )
            .outerjoin(UserUiGroup, User.id == UserUiGroup.user_id)
            .outerjoin(UiGroup, UserUiGroup.group_id == UiGroup.id)
            .where(
                or_(
                    User.email.ilike(pattern),
                    User.full_name.ilike(pattern),
                    User.role.ilike(pattern),
                    S3Account.name.ilike(pattern),
                    S3Account.rgw_account_id.ilike(pattern),
                    func.coalesce(S3User.name, "").ilike(pattern),
                    func.coalesce(S3User.rgw_user_uid, "").ilike(pattern),
                    func.coalesce(linked_connection.name, "").ilike(pattern),
                    func.coalesce(UiGroup.name, "").ilike(pattern),
                )
            )
            .distinct()
        )

    @staticmethod
    def _order_columns(sort_field: str, sort_direction: str) -> list[Any]:
        name_sort = func.lower(
            func.coalesce(
                func.nullif(func.trim(User.full_name), ""),
                User.email,
            )
        )
        sort_map = {
            "name": name_sort,
            "full_name": name_sort,
            "email": User.email,
            "role": User.role,
            "created_at": User.created_at,
            "last_login_at": User.last_login_at,
            "last_login": User.last_login_at,
        }
        order_column = sort_map.get(sort_field, User.email)
        uses_email_sort = sort_field == "email" or sort_field not in sort_map
        if sort_direction == "desc":
            order_column = order_column.desc()
        if sort_field in {"last_login_at", "last_login"}:
            order_column = order_column.nulls_last()

        order_columns = [order_column]
        if not uses_email_sort:
            order_columns.append(
                User.email.desc() if sort_direction == "desc" else User.email.asc()
            )
        order_columns.append(User.id.asc())
        return order_columns

    def paginate_users(
        self,
        page: int,
        page_size: int,
        search: str | None = None,
        sort_field: str = "name",
        sort_direction: str = "asc",
    ) -> tuple[list[UserOut], int]:
        search_value = search.strip() if isinstance(search, str) else ""
        statement = self._apply_search(select(User), search_value)
        rows, total = paginate_scalars(
            self.db,
            statement,
            order_by=self._order_columns(sort_field, sort_direction),
            page=page,
            page_size=page_size,
            unique=True,
        )
        output_service = UserOutputService(self.db)
        preloaded = output_service.preload(rows)
        outputs = [
            output_service.to_out(user, preloaded=preloaded)
            for user in rows
        ]
        return outputs, total
