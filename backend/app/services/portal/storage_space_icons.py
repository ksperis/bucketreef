# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

from app.core.db_transactions import run_replayable_db_unit
from app.db import PortalStorageSpaceMetadata, User
from app.core.domain_enums import PortalAccountRole
from app.models.portal_storage_spaces import (
    PortalStorageSpaceIcon,
    PortalStorageSpaceIconPreset,
    PortalStorageSpaceIconSource,
)
from app.services.avatar_image_service import ALLOWED_AVATAR_CONTENT_TYPES, validate_avatar_image
from app.services.portal.exceptions import PortalForbiddenError, PortalNotFoundError
from app.utils.time import utcnow

if TYPE_CHECKING:
    from app.services.access_context_contracts import AccountAccess


STORAGE_SPACE_ICON_PRESETS = {"bucket", "folder", "archive", "database", "media"}


class PortalStorageSpaceIconsMixin:
    def _storage_space_icon_descriptor(
        self,
        metadata: PortalStorageSpaceMetadata | None,
    ) -> PortalStorageSpaceIcon:
        if metadata is None:
            return PortalStorageSpaceIcon(
                source="preset",
                preset="bucket",
                url=None,
                updated_at=None,
            )
        updated_at = metadata.icon_updated_at
        source = str(metadata.icon_source)
        if (
            source == "uploaded"
            and metadata.icon_image
            and metadata.icon_content_type in ALLOWED_AVATAR_CONTENT_TYPES
        ):
            version = int(updated_at.timestamp() * 1_000_000) if updated_at else 0
            encoded_space_id = quote(metadata.bucket_name, safe="")
            return PortalStorageSpaceIcon(
                source="uploaded",
                preset=None,
                url=(
                    f"/portal/storage-spaces/{encoded_space_id}/icon/image"
                    f"?account_id={metadata.account_id}&v={version}"
                ),
                updated_at=updated_at,
            )
        preset = str(metadata.icon_preset)
        return PortalStorageSpaceIcon(
            source="preset",
            preset=preset,
            url=None,
            updated_at=updated_at,
        )

    def _visible_storage_space_icon_metadata(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceMetadata:
        metadata = self._storage_space_metadata(access.account, space_id)
        if metadata is None:
            raise PortalNotFoundError("Storage space icon not found or not allowed.")
        visible = self._storage_space_roles_by_bucket(
            user,
            access.account,
            access.portal_role,
            include_archived=True,
        )
        if metadata.bucket_name not in visible:
            raise PortalNotFoundError("Storage space icon not found or not allowed.")
        return metadata

    def set_storage_space_icon_choice(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        *,
        source: PortalStorageSpaceIconSource,
        preset: PortalStorageSpaceIconPreset | None = None,
    ) -> PortalStorageSpaceIcon:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise PortalForbiddenError("Only project managers can configure Storage Space icons.")
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        if source != "uploaded" and preset not in STORAGE_SPACE_ICON_PRESETS:
            raise ValueError("Select a valid Storage Space pictogram.")
        metadata_id = metadata.id
        updated_at = utcnow()

        def persist_choice(write_db):
            current_metadata = write_db.get(PortalStorageSpaceMetadata, metadata_id)
            if current_metadata is None:
                raise PortalNotFoundError("Storage space icon not found or not allowed.")
            if source == "uploaded":
                if not current_metadata.icon_image:
                    raise ValueError("Upload a Storage Space image before selecting it.")
            else:
                current_metadata.icon_preset = preset
            current_metadata.icon_source = source
            current_metadata.icon_updated_at = updated_at

        run_replayable_db_unit(self.db, persist_choice)
        metadata = self.db.get(PortalStorageSpaceMetadata, metadata_id)
        if metadata is None:
            raise PortalNotFoundError("Storage space icon not found or not allowed.")
        return self._storage_space_icon_descriptor(metadata)

    def store_storage_space_icon_image(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
        payload: bytes,
        content_type: str | None,
    ) -> PortalStorageSpaceIcon:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise PortalForbiddenError("Only project managers can configure Storage Space icons.")
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        detected_type = validate_avatar_image(payload, content_type)
        metadata_id = metadata.id
        updated_at = utcnow()

        def persist_image(write_db):
            current_metadata = write_db.get(PortalStorageSpaceMetadata, metadata_id)
            if current_metadata is None:
                raise PortalNotFoundError("Storage space icon not found or not allowed.")
            current_metadata.icon_image = payload
            current_metadata.icon_content_type = detected_type
            current_metadata.icon_source = "uploaded"
            current_metadata.icon_updated_at = updated_at

        run_replayable_db_unit(self.db, persist_image)
        metadata = self.db.get(PortalStorageSpaceMetadata, metadata_id)
        if metadata is None:
            raise PortalNotFoundError("Storage space icon not found or not allowed.")
        return self._storage_space_icon_descriptor(metadata)

    def remove_storage_space_icon_image(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> PortalStorageSpaceIcon:
        if access.portal_role != PortalAccountRole.PORTAL_MANAGER.value:
            raise PortalForbiddenError("Only project managers can configure Storage Space icons.")
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        metadata_id = metadata.id
        updated_at = utcnow()

        def remove_image(write_db):
            current_metadata = write_db.get(PortalStorageSpaceMetadata, metadata_id)
            if current_metadata is None:
                raise PortalNotFoundError("Storage space icon not found or not allowed.")
            current_metadata.icon_image = None
            current_metadata.icon_content_type = None
            current_metadata.icon_source = "preset"
            current_metadata.icon_updated_at = updated_at

        run_replayable_db_unit(self.db, remove_image)
        metadata = self.db.get(PortalStorageSpaceMetadata, metadata_id)
        if metadata is None:
            raise PortalNotFoundError("Storage space icon not found or not allowed.")
        return self._storage_space_icon_descriptor(metadata)

    def storage_space_icon_image(
        self,
        user: User,
        access: "AccountAccess",
        space_id: str,
    ) -> tuple[bytes, str, str]:
        metadata = self._visible_storage_space_icon_metadata(user, access, space_id)
        if not metadata.icon_image or metadata.icon_content_type not in ALLOWED_AVATAR_CONTENT_TYPES:
            raise PortalNotFoundError("Storage space icon not found or not allowed.")
        version = str(
            int(metadata.icon_updated_at.timestamp() * 1_000_000)
            if metadata.icon_updated_at
            else 0
        )
        return bytes(metadata.icon_image), str(metadata.icon_content_type), version
