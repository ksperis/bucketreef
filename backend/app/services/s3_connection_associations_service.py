# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.s3_connection import UserS3Connection
from app.db.ui_group import UiGroup, UiGroupS3Connection
from app.db.user import User
from app.services.association_validation import ensure_association_ids_exist


class S3ConnectionAssociationsService:
    """Validate and synchronize a shared connection's UI associations."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def validate_updates(
        self,
        *,
        group_ids: Optional[list[int]],
        user_ids: Optional[list[int]],
    ) -> tuple[Optional[list[int]], Optional[list[int]]]:
        return (
            self._validated_group_ids(group_ids),
            self._validated_user_ids(user_ids),
        )

    def replace_links(
        self,
        connection_id: int,
        *,
        group_ids: Optional[list[int]],
        user_ids: Optional[list[int]],
    ) -> None:
        if group_ids is not None:
            self._replace_group_links(connection_id, group_ids)
        if user_ids is not None:
            self._replace_user_links(connection_id, user_ids)

    def delete_links(self, connection_id: int) -> None:
        (
            self.db.query(UserS3Connection)
            .filter(UserS3Connection.s3_connection_id == connection_id)
            .delete(synchronize_session=False)
        )
        (
            self.db.query(UiGroupS3Connection)
            .filter(UiGroupS3Connection.s3_connection_id == connection_id)
            .delete(synchronize_session=False)
        )

    def _validated_group_ids(
        self,
        group_ids: Optional[list[int]],
    ) -> Optional[list[int]]:
        return self._validated_ids(group_ids, id_column=UiGroup.id, entity_label="UI groups")

    def _validated_user_ids(
        self,
        user_ids: Optional[list[int]],
    ) -> Optional[list[int]]:
        return self._validated_ids(user_ids, id_column=User.id, entity_label="UI users")

    def _validated_ids(
        self,
        ids: Optional[list[int]],
        *,
        id_column: Any,
        entity_label: str,
    ) -> Optional[list[int]]:
        if ids is None:
            return None
        cleaned_ids = sorted({int(item_id) for item_id in ids})
        if not cleaned_ids:
            return []
        ensure_association_ids_exist(
            self.db,
            id_column,
            cleaned_ids,
            entity_label=entity_label,
        )
        return cleaned_ids

    def _replace_group_links(
        self,
        connection_id: int,
        group_ids: list[int],
    ) -> None:
        existing = (
            self.db.query(UiGroupS3Connection)
            .filter(UiGroupS3Connection.s3_connection_id == connection_id)
            .all()
        )
        existing_ids = {int(link.group_id) for link in existing}
        desired_ids = set(group_ids)
        removed_ids = existing_ids - desired_ids
        if removed_ids:
            (
                self.db.query(UiGroupS3Connection)
                .filter(
                    UiGroupS3Connection.s3_connection_id == connection_id,
                    UiGroupS3Connection.group_id.in_(removed_ids),
                )
                .delete(synchronize_session=False)
            )
        for group_id in sorted(desired_ids - existing_ids):
            self.db.add(
                UiGroupS3Connection(
                    group_id=group_id,
                    s3_connection_id=connection_id,
                )
            )

    def _replace_user_links(
        self,
        connection_id: int,
        user_ids: list[int],
    ) -> None:
        existing = (
            self.db.query(UserS3Connection)
            .filter(UserS3Connection.s3_connection_id == connection_id)
            .all()
        )
        existing_ids = {int(link.user_id) for link in existing}
        desired_ids = set(user_ids)
        removed_ids = existing_ids - desired_ids
        if removed_ids:
            (
                self.db.query(UserS3Connection)
                .filter(
                    UserS3Connection.s3_connection_id == connection_id,
                    UserS3Connection.user_id.in_(removed_ids),
                )
                .delete(synchronize_session=False)
            )
        for user_id in sorted(desired_ids - existing_ids):
            self.db.add(
                UserS3Connection(
                    user_id=user_id,
                    s3_connection_id=connection_id,
                )
            )
