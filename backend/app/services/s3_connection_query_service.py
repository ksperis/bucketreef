# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import S3ConnectionNotFoundError
from app.db.s3_connection import S3Connection as DBS3Connection, UserS3Connection
from app.models.s3_connection import S3Connection
from app.services.mappers.s3_connection import s3_connection_from_db
from app.services.tags_service import TagsService
from app.utils.name_ordering import name_order_by
from app.utils.s3_connection_capabilities import validate_s3_connection_capabilities


class S3ConnectionQueryService:
    """Read and project S3 connections without owning mutation workflows."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.tags = TagsService(db)

    def list_for_user(self, user_id: int) -> list[S3Connection]:
        """List connections visible to a UI user."""
        rows = self.db.scalars(
            select(DBS3Connection)
            .outerjoin(
                UserS3Connection,
                UserS3Connection.s3_connection_id == DBS3Connection.id,
            )
            .where(
                (
                    (DBS3Connection.is_shared.is_(False))
                    & (DBS3Connection.created_by_user_id == user_id)
                )
                | (
                    (DBS3Connection.is_shared.is_(True))
                    & (UserS3Connection.user_id == user_id)
                ),
            )
            .distinct()
            .order_by(*name_order_by(DBS3Connection))
        ).all()
        return [self.serialize(row) for row in rows]

    def list_owned_private(self, user_id: int) -> list[S3Connection]:
        """List private connections managed by the authenticated creator."""
        rows = self.db.scalars(
            select(DBS3Connection)
            .where(
                DBS3Connection.created_by_user_id == user_id,
                DBS3Connection.is_shared.is_(False),
            )
            .order_by(*name_order_by(DBS3Connection))
        ).all()
        return [self.serialize(row) for row in rows]

    @staticmethod
    def admin_shared_predicates():
        """Return the single scope used by every Admin selector."""
        return (DBS3Connection.is_shared.is_(True),)

    def get_admin_shared(self, connection_id: int) -> DBS3Connection:
        row = self.db.scalar(
            select(DBS3Connection).where(
                *self.admin_shared_predicates(),
                DBS3Connection.id == connection_id,
            )
        )
        if row is None:
            raise S3ConnectionNotFoundError("S3Connection not found")
        return row

    def get_record(self, connection_id: int) -> DBS3Connection:
        row = self.db.get(DBS3Connection, connection_id)
        if row is None:
            raise S3ConnectionNotFoundError("S3Connection not found")
        return row

    def get_owned(self, user_id: int, connection_id: int) -> DBS3Connection:
        row = self.db.scalar(
            select(DBS3Connection).where(
                DBS3Connection.created_by_user_id == user_id,
                DBS3Connection.id == connection_id,
            )
        )
        if row is None or row.is_shared:
            raise S3ConnectionNotFoundError("S3Connection not found")
        return row

    def serialize(self, row: DBS3Connection) -> S3Connection:
        return s3_connection_from_db(
            row,
            capabilities=validate_s3_connection_capabilities(row.capabilities),
            tags=self.tags.get_connection_tags(row),
        )
