# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from sqlalchemy import delete
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.db.s3_connection import UserS3Connection
from app.db.ui_group import UiGroup, UiGroupS3Connection
from app.db.user import User
from app.services.association_sync import sync_simple_association_links
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
            self._validated_ids(group_ids, id_column=UiGroup.id, entity_label="UI groups"),
            self._validated_ids(user_ids, id_column=User.id, entity_label="UI users"),
        )

    def replace_links(
        self,
        connection_id: int,
        *,
        group_ids: Optional[list[int]],
        user_ids: Optional[list[int]],
    ) -> None:
        if group_ids is not None:
            sync_simple_association_links(
                self.db,
                link_model=UiGroupS3Connection,
                owner_column=UiGroupS3Connection.s3_connection_id,
                owner_id=connection_id,
                target_column=UiGroupS3Connection.group_id,
                desired_ids=group_ids,
                link_factory=lambda group_id: UiGroupS3Connection(
                    group_id=group_id,
                    s3_connection_id=connection_id,
                ),
            )
        if user_ids is not None:
            sync_simple_association_links(
                self.db,
                link_model=UserS3Connection,
                owner_column=UserS3Connection.s3_connection_id,
                owner_id=connection_id,
                target_column=UserS3Connection.user_id,
                desired_ids=user_ids,
                link_factory=lambda user_id: UserS3Connection(
                    user_id=user_id,
                    s3_connection_id=connection_id,
                ),
            )

    def delete_links(self, connection_id: int) -> None:
        self.db.execute(
            delete(UserS3Connection)
            .where(UserS3Connection.s3_connection_id == connection_id)
            .execution_options(synchronize_session=False)
        )
        self.db.execute(
            delete(UiGroupS3Connection)
            .where(UiGroupS3Connection.s3_connection_id == connection_id)
            .execution_options(synchronize_session=False)
        )

    def _validated_ids(
        self,
        ids: Optional[list[int]],
        *,
        id_column: InstrumentedAttribute[int],
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
