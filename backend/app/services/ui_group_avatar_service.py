# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.core.domain_errors import AvatarNotFoundError
from app.db import UiGroup
from app.models.ui_group import UiGroupAvatar, UiGroupAvatarIcon, UiGroupAvatarSource
from app.services.avatar_image_service import (
    ALLOWED_AVATAR_CONTENT_TYPES,
    validate_avatar_image,
)
from app.utils.time import utcnow


GROUP_AVATAR_ICONS = {"users", "building", "shield", "briefcase", "academic"}


def _group_initials(name: str) -> str:
    parts = [part for part in re.split(r"[^\w]+", str(name or "").strip(), flags=re.UNICODE) if part]
    if len(parts) >= 2:
        return f"{parts[0][0]}{parts[-1][0]}".upper()
    if parts:
        return parts[0][:2].upper()
    return "GR"


class UiGroupAvatarService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def descriptor(self, group: UiGroup) -> UiGroupAvatar:
        source = str(group.avatar_source)
        initials = _group_initials(group.name)
        if source == "uploaded" and group.avatar_image and group.avatar_content_type in ALLOWED_AVATAR_CONTENT_TYPES:
            version = int(group.avatar_updated_at.timestamp()) if group.avatar_updated_at else 0
            return UiGroupAvatar(
                source="uploaded",
                initials=initials,
                icon=None,
                url=f"/admin/groups/{group.id}/avatar?v={version}",
                updated_at=group.avatar_updated_at,
            )
        icon = str(group.avatar_icon or "")
        if source == "preset" and icon in GROUP_AVATAR_ICONS:
            return UiGroupAvatar(
                source="preset",
                initials=initials,
                icon=icon,
                url=None,
                updated_at=group.avatar_updated_at,
            )
        return UiGroupAvatar(
            source="initials",
            initials=initials,
            icon=None,
            url=None,
            updated_at=group.avatar_updated_at,
        )

    def set_choice(
        self,
        group: UiGroup,
        source: UiGroupAvatarSource,
        icon: UiGroupAvatarIcon | None,
    ) -> None:
        if source == "uploaded" and not group.avatar_image:
            raise ValueError("Upload a group image before selecting it.")
        if source == "preset":
            if icon not in GROUP_AVATAR_ICONS:
                raise ValueError("Select a valid group pictogram.")
            group.avatar_icon = icon
        else:
            group.avatar_icon = None
        group.avatar_source = source
        group.avatar_updated_at = utcnow()

    def store_uploaded_image(self, group: UiGroup, payload: bytes, content_type: str | None) -> None:
        group_id = int(group.id)
        normalized_content_type = validate_avatar_image(payload, content_type)
        updated_at = utcnow()

        def persist(write_db: Session) -> None:
            target = write_db.get(UiGroup, group_id)
            if target is None:
                raise ValueError("UI group does not exist")
            target.avatar_content_type = normalized_content_type
            target.avatar_image = payload
            target.avatar_updated_at = updated_at
            target.avatar_source = "uploaded"

        run_replayable_db_unit(self.db, persist)
        self.db.get(UiGroup, group_id, populate_existing=True)

    def remove_uploaded_image(self, group: UiGroup) -> None:
        group_id = int(group.id)
        updated_at = utcnow()

        def persist(write_db: Session) -> None:
            target = write_db.get(UiGroup, group_id)
            if target is None:
                raise ValueError("UI group does not exist")
            target.avatar_image = None
            target.avatar_content_type = None
            target.avatar_updated_at = updated_at
            if target.avatar_source == "uploaded":
                target.avatar_source = "initials"

        run_replayable_db_unit(self.db, persist)
        self.db.get(UiGroup, group_id, populate_existing=True)

    def image(self, group_id: int) -> tuple[bytes, str, str]:
        group = self.db.get(UiGroup, group_id)
        if group is None or not group.avatar_image or group.avatar_content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
            raise AvatarNotFoundError("Group avatar not found.")
        version = str(int(group.avatar_updated_at.timestamp()) if group.avatar_updated_at else 0)
        return bytes(group.avatar_image), str(group.avatar_content_type), version
