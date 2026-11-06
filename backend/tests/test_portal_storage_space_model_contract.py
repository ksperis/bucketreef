# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
import pytest

from app.db import User
from app.main import app
from app.models.portal_storage_spaces import (
    PortalStorageSpaceCollaboratorPreview,
    PortalStorageSpaceCreate,
    PortalStorageSpaceIcon,
    PortalStorageSpaceImport,
    PortalStorageSpaceListingRequest,
    PortalStorageSpaceSummary,
    PortalStorageSpaceUpdate,
)
from app.routers import portal_storage_spaces


PRIVATE_STORAGE_SPACE_ACCESS = {
    "visibility": "private",
    "share_scope": "restricted",
    "account_member_role": None,
    "initial_shares": [],
}


@pytest.mark.parametrize("name", ["bad**name", "Uppercase", " bucket ", "a" * 64])
def test_named_space_api_returns_field_error_before_any_mutation(name):
    test_app = FastAPI()
    test_app.include_router(portal_storage_spaces.router, prefix="/api/portal")
    service, audit = Mock(), Mock()
    test_app.dependency_overrides[portal_storage_spaces.get_portal_account_access] = lambda: SimpleNamespace(
        actor=User(id=1, email="actor@example.com", hashed_password="x", role="ui_user"),
    )
    test_app.dependency_overrides[portal_storage_spaces.get_portal_service_dependency] = lambda: service
    test_app.dependency_overrides[portal_storage_spaces.get_audit_service] = lambda: audit
    with TestClient(test_app) as client:
        response = client.post(
            "/api/portal/storage-spaces",
            json={"name": name, "naming_mode": "named_bucket", **PRIVATE_STORAGE_SPACE_ACCESS},
        )
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "name"]
    service.create_storage_space.assert_not_called()
    audit.record_action.assert_not_called()


@pytest.mark.parametrize("name", ["bucket**", "Mon_Bucket", " reports ", "a" * 64, "ab", "a..b", "a.-b", "127.0.0.1", "bucket\n"])
def test_named_space_validation_is_attached_to_name_without_normalization(name):
    with pytest.raises(ValidationError) as caught:
        PortalStorageSpaceCreate(
            name=name,
            naming_mode="named_bucket",
            **PRIVATE_STORAGE_SPACE_ACCESS,
        )
    assert caught.value.errors()[0]["loc"] == ("name",)


def test_generic_space_names_remain_display_labels_and_named_ids_are_exact():
    assert PortalStorageSpaceCreate(
        name="  Résultats  projet *** ",
        naming_mode="generic_uuid",
        **PRIVATE_STORAGE_SPACE_ACCESS,
    ).name == "Résultats projet ***"
    for name in ["research-data.v1", "a" * 63]:
        assert PortalStorageSpaceCreate(
            name=name,
            naming_mode="named_bucket",
            **PRIVATE_STORAGE_SPACE_ACCESS,
        ).name == name


def test_storage_space_create_and_import_require_explicit_access_choices() -> None:
    assert set(PortalStorageSpaceCreate.model_json_schema()["required"]) == {
        "naming_mode",
        "name",
        "visibility",
        "share_scope",
        "account_member_role",
        "initial_shares",
    }
    assert set(PortalStorageSpaceImport.model_json_schema()["required"]) == {
        "bucket_name",
        "visibility",
        "share_scope",
        "account_member_role",
        "initial_shares",
    }


def test_storage_space_update_exposes_only_mutable_fields() -> None:
    schema = PortalStorageSpaceUpdate.model_json_schema()
    assert set(schema["properties"]) == {
        "name",
        "description",
        "share_scope",
        "account_member_role",
        "project_key",
        "dataset_label",
        "archived",
    }
    for removed_field, value in (
        ("visibility", "private"),
        ("naming_mode", "generic_uuid"),
        ("initial_shares", []),
    ):
        with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
            PortalStorageSpaceUpdate(**{removed_field: value})


def test_storage_space_update_distinguishes_omitted_and_nullable_fields() -> None:
    update = PortalStorageSpaceUpdate(
        description=None,
        project_key=None,
        dataset_label=None,
        account_member_role=None,
    )
    assert update.model_fields_set == {
        "description",
        "project_key",
        "dataset_label",
        "account_member_role",
    }


@pytest.mark.parametrize("field_name", ["name", "share_scope", "archived"])
def test_storage_space_update_rejects_null_for_non_nullable_fields(field_name: str) -> None:
    with pytest.raises(ValidationError, match=f"{field_name} cannot be null"):
        PortalStorageSpaceUpdate(**{field_name: None})


def test_portal_storage_space_models_have_a_single_canonical_module() -> None:
    assert PortalStorageSpaceSummary.__module__ == "app.models.portal_storage_spaces"


def test_portal_storage_space_icon_requires_complete_canonical_payload() -> None:
    assert set(PortalStorageSpaceIcon.model_json_schema()["required"]) == {
        "source",
        "preset",
        "url",
        "updated_at",
    }


def test_portal_storage_space_summary_requires_complete_canonical_payload() -> None:
    for model in (PortalStorageSpaceSummary, PortalStorageSpaceCollaboratorPreview):
        schema = model.model_json_schema()
        assert set(schema["required"]) == set(schema["properties"])


def test_portal_storage_space_listing_request_rejects_noncanonical_filters() -> None:
    request = PortalStorageSpaceListingRequest()
    assert request.model_dump() == {
        "search": None,
        "role": None,
        "status": None,
        "sort": "name",
        "include_archived": False,
    }

    for field, value in (
        ("role", "owner"),
        ("status", "active"),
        ("sort", "unknown"),
    ):
        with pytest.raises(ValidationError):
            PortalStorageSpaceListingRequest(**{field: value})


def test_portal_storage_space_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    list_spaces = paths["/api/portal/storage-spaces"]["get"]
    list_schema = list_spaces["responses"]["200"]["content"]["application/json"]["schema"]
    assert list_schema["type"] == "array"
    assert list_schema["items"] == {"$ref": "#/components/schemas/PortalStorageSpaceSummary"}
    list_parameters = {
        parameter["name"]: parameter
        for parameter in list_spaces["parameters"]
        if parameter["in"] == "query"
    }
    assert set(list_parameters) == {
        "search",
        "role",
        "status",
        "sort",
        "include_archived",
        "account_id",
    }
    assert list_parameters["sort"]["schema"]["default"] == "name"
    assert set(list_parameters["sort"]["schema"]["enum"]) == {
        "name",
        "-name",
        "created_at",
        "-created_at",
        "used_bytes",
        "-used_bytes",
        "object_count",
        "-object_count",
        "role",
        "-role",
        "status",
        "-status",
    }

    create_space = paths["/api/portal/storage-spaces"]["post"]
    assert create_space["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceCreate"
    }
    assert create_space["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceSummary"
    }

    update_space = paths["/api/portal/storage-spaces/{space_id}"]["patch"]
    assert update_space["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceUpdate"
    }

    assert "PortalStorageSpace" not in app.openapi()["components"]["schemas"]
