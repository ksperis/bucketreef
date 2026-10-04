# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models import storage_endpoint as storage_endpoint_models
from app.models.storage_endpoint import (
    StorageEndpoint,
    StorageEndpointCreate,
    StorageEndpointMetadata,
    StorageEndpointUpdate,
)


def test_storage_endpoint_read_and_write_contracts_share_metadata_only() -> None:
    assert StorageEndpointCreate.__bases__ == (StorageEndpointMetadata,)
    assert StorageEndpoint.__bases__ == (StorageEndpointMetadata,)
    assert not hasattr(storage_endpoint_models, "StorageEndpointBase")


def test_storage_endpoint_create_openapi_contract_is_preserved() -> None:
    operation = app.openapi()["paths"]["/api/admin/storage-endpoints"]["post"]

    assert operation["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StorageEndpointCreate"
    }
    assert operation["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StorageEndpoint"
    }

    schemas = app.openapi()["components"]["schemas"]
    assert "StorageEndpointBase" not in schemas

    read_properties = schemas["StorageEndpoint"]["properties"]
    assert {
        "service_identity_mode",
        "runtime_access_key",
        "runtime_secret_key",
        "has_runtime_secret",
        "supervision_access_key",
        "supervision_secret_key",
        "has_supervision_secret",
    }.isdisjoint(read_properties)

    for schema_name in ("StorageEndpointCreate", "StorageEndpointUpdate"):
        write_properties = schemas[schema_name]["properties"]
        assert "runtime_access_key" in write_properties
        assert "runtime_secret_key" in write_properties
        assert "supervision_access_key" in write_properties
        assert "supervision_secret_key" in write_properties
        for secret_name in (
            "admin_secret_key",
            "runtime_secret_key",
            "supervision_secret_key",
        ):
            secret_variants = write_properties[secret_name]["anyOf"]
            assert {
                "type": "string",
                "format": "password",
                "writeOnly": True,
            } in secret_variants

    identity_properties = schemas["EndpointServiceIdentityStatus"]["properties"]
    assert "credentials_configured" in identity_properties
    assert "access_key" not in identity_properties
    assert "secret_key" not in identity_properties


def test_storage_endpoint_response_serialization_never_contains_service_credentials() -> None:
    assert "runtime_access_key" not in StorageEndpoint.model_fields
    assert "supervision_access_key" not in StorageEndpoint.model_fields
    assert "runtime_secret_key" not in StorageEndpoint.model_fields
    assert "supervision_secret_key" not in StorageEndpoint.model_fields
    assert "runtime_access_key" in StorageEndpointCreate.model_fields
    assert "supervision_access_key" in StorageEndpointCreate.model_fields
