# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from typing import Any

from app.models.portal_storage_spaces import (
    PortalStorageSpaceIcon,
    PortalStorageSpaceSummary,
)


def portal_storage_space_summary(**overrides: Any) -> PortalStorageSpaceSummary:
    values: dict[str, Any] = {
        "id": "space",
        "name": "Storage Space",
        "role": "Viewer",
        "can_browse": True,
        "can_take_ownership": False,
        "can_delete": False,
        "status": "Active",
        "description": None,
        "owner_label": None,
        "owner_user_id": None,
        "collaborators": [],
        "collaborator_count": 0,
        "visibility": "private",
        "share_scope": "restricted",
        "account_member_role": None,
        "project_key": None,
        "dataset_label": None,
        "region": None,
        "created_at": None,
        "used_bytes": None,
        "object_count": None,
        "quota_max_size_bytes": None,
        "quota_max_objects": None,
        "internal_bucket_name": None,
        "archived_at": None,
        "origin": "imported",
        "name_editable": False,
        "icon": PortalStorageSpaceIcon(
            source="preset",
            preset="bucket",
            url=None,
            updated_at=None,
        ),
    }
    values.update(overrides)
    return PortalStorageSpaceSummary(**values)
