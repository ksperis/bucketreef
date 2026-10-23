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
from app.models.portal_storage_spaces import PortalStorageSpaceCreate, PortalStorageSpaceIcon, PortalStorageSpaceSummary
from app.routers import portal_storage_spaces


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
        response = client.post("/api/portal/storage-spaces", json={"name": name, "naming_mode": "named_bucket"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "name"]
    service.create_storage_space.assert_not_called()
    audit.record_action.assert_not_called()


@pytest.mark.parametrize("name", ["bucket**", "Mon_Bucket", " reports ", "a" * 64, "ab", "a..b", "a.-b", "127.0.0.1", "bucket\n"])
def test_named_space_validation_is_attached_to_name_without_normalization(name):
    with pytest.raises(ValidationError) as caught:
        PortalStorageSpaceCreate(name=name, naming_mode="named_bucket")
    assert caught.value.errors()[0]["loc"] == ("name",)


def test_generic_space_names_remain_display_labels_and_named_ids_are_exact():
    assert PortalStorageSpaceCreate(name="  Résultats  projet *** ").name == "Résultats projet ***"
    for name in ["research-data.v1", "a" * 63]:
        assert PortalStorageSpaceCreate(name=name, naming_mode="named_bucket").name == name


def test_portal_storage_space_models_have_a_single_canonical_module() -> None:
    assert PortalStorageSpaceSummary.__module__ == "app.models.portal_storage_spaces"


def test_portal_storage_space_icon_requires_complete_canonical_payload() -> None:
    assert set(PortalStorageSpaceIcon.model_json_schema()["required"]) == {
        "source",
        "preset",
        "url",
        "updated_at",
    }


def test_portal_storage_space_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    list_spaces = paths["/api/portal/storage-spaces"]["get"]
    list_schema = list_spaces["responses"]["200"]["content"]["application/json"]["schema"]
    assert list_schema["type"] == "array"
    assert list_schema["items"] == {"$ref": "#/components/schemas/PortalStorageSpaceSummary"}

    create_space = paths["/api/portal/storage-spaces"]["post"]
    assert create_space["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceCreate"
    }
    assert create_space["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceSummary"
    }

    assert "PortalStorageSpace" not in app.openapi()["components"]["schemas"]
