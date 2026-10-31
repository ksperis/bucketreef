# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.base import ApiModel
from app.models.bucket_ui_tags import (
    BucketUiTagCatalogResponse,
    BucketUiTagDefinitionSummary,
    CephAdminBucketUiTagCreate,
    CephAdminBucketUiTagDefinitionPatch,
    CephAdminBucketUiTagTarget,
    StorageOpsBucketUiTagCreate,
    StorageOpsBucketUiTagDefinitionPatch,
    StorageOpsBucketUiTagTarget,
)
from app.models.tagging import TagDefinitionInput


def test_bucket_ui_tag_responses_require_complete_canonical_payloads() -> None:
    assert set(BucketUiTagDefinitionSummary.model_json_schema()["required"]) == {
        "id",
        "label",
        "color_key",
        "scope",
        "visibility",
    }
    assert set(BucketUiTagCatalogResponse.model_json_schema()["required"]) == {
        "definitions"
    }


def test_storage_ops_ui_tag_models_are_the_canonical_bases() -> None:
    assert StorageOpsBucketUiTagCreate.__bases__ == (ApiModel,)
    assert CephAdminBucketUiTagCreate.__bases__ == (StorageOpsBucketUiTagCreate,)
    assert StorageOpsBucketUiTagDefinitionPatch.__bases__ == (ApiModel,)
    assert CephAdminBucketUiTagDefinitionPatch.__bases__ == (StorageOpsBucketUiTagDefinitionPatch,)


def test_tag_models_share_canonical_label_and_color_normalization() -> None:
    tag = TagDefinitionInput(label="  Production  ", color_key=" BLUE ")
    storage_tag = StorageOpsBucketUiTagCreate(label="  Production  ", color_key=" BLUE ")
    ceph_target = CephAdminBucketUiTagTarget(name="  bucket-a  ")
    storage_target = StorageOpsBucketUiTagTarget(context_id=" context-a ", name="  bucket-a  ")

    assert (tag.label, tag.color_key) == ("Production", "blue")
    assert (storage_tag.label, storage_tag.color_key) == ("Production", "blue")
    assert ceph_target.name == "bucket-a"
    assert (storage_target.context_id, storage_target.name) == ("context-a", "bucket-a")


def test_ui_tag_definition_routes_keep_public_patch_components() -> None:
    paths = app.openapi()["paths"]

    ceph_patch = paths["/api/ceph-admin/endpoints/{endpoint_id}/bucket-ui-tags/{tag_id}"]["patch"]
    storage_ops_patch = paths["/api/storage-ops/bucket-ui-tags/{tag_id}"]["patch"]

    assert ceph_patch["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CephAdminBucketUiTagDefinitionPatch"
    }
    assert storage_ops_patch["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StorageOpsBucketUiTagDefinitionPatch"
    }

    schemas = app.openapi()["components"]["schemas"]
    assert "_BucketUiTagCreateBase" not in schemas
    assert "_BucketUiTagDefinitionPatchBase" not in schemas
