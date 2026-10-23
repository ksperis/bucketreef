# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.portal_objects import PortalStorageObjectDeleteResponse, PortalStorageObjectDetail
from app.models.portal_versions import PortalStorageObjectRestoreResponse, PortalStorageObjectVersion, PortalStorageObjectVersionsResponse


def test_portal_object_models_have_a_single_canonical_module() -> None:
    assert PortalStorageObjectDetail.__module__ == "app.models.portal_objects"
    assert PortalStorageObjectDeleteResponse.__module__ == "app.models.portal_objects"


def test_portal_object_detail_requires_complete_canonical_payload() -> None:
    assert set(PortalStorageObjectDetail.model_json_schema()["required"]) == {
        "key",
        "name",
        "size",
        "last_modified",
        "content_type",
        "storage_class",
        "encryption",
        "preview_type",
        "preview_text",
        "preview_unavailable_reason",
    }


def test_portal_object_history_requires_complete_canonical_payloads() -> None:
    assert set(PortalStorageObjectVersion.model_json_schema()["required"]) == {
        "key",
        "version_id",
        "is_latest",
        "is_delete_marker",
        "last_modified",
        "size",
    }
    assert set(PortalStorageObjectVersionsResponse.model_json_schema()["required"]) == {
        "key",
        "versioning_status",
        "can_restore",
        "versions",
        "is_truncated",
        "next_key_marker",
        "next_version_id_marker",
    }
    assert set(PortalStorageObjectRestoreResponse.model_json_schema()["required"]) == {
        "key",
        "restored_from_version_id",
        "message",
    }


def test_portal_object_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    detail = paths["/api/portal/storage-spaces/{space_id}/objects/detail"]["get"]
    assert detail["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageObjectDetail"
    }

    delete = paths["/api/portal/storage-spaces/{space_id}/objects"]["delete"]
    assert delete["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageObjectDeleteResponse"
    }
