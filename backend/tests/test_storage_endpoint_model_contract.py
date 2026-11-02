# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

import pytest
from pydantic import ValidationError

from app.main import app
from app.models import storage_endpoint as storage_endpoint_models
from app.models.storage_endpoint import (
    StorageEndpoint,
    StorageEndpointCreate,
    StorageEndpointMetadata,
    StorageEndpointUpdate,
)


@pytest.mark.parametrize(
    "field",
    [
        "name",
        "endpoint_url",
        "force_path_style",
        "verify_tls",
        "provider",
        "service_identity_mode",
        "ceph_admin_allowed",
        "features",
    ],
)
def test_storage_endpoint_update_rejects_null_for_concrete_mutations(field: str) -> None:
    with pytest.raises(ValidationError, match=rf"{field} cannot be null"):
        StorageEndpointUpdate.model_validate({field: None})


@pytest.mark.parametrize(
    "field",
    [
        "region",
        "realm_id",
        "zonegroup_id",
        "zone_id",
        "latitude",
        "longitude",
        "admin_access_key",
        "admin_secret_key",
        "runtime_access_key",
        "runtime_secret_key",
        "ceph_admin_access_key",
        "ceph_admin_secret_key",
        "supervision_access_key",
        "supervision_secret_key",
    ],
)
def test_storage_endpoint_update_preserves_explicit_nullable_resets(field: str) -> None:
    payload = StorageEndpointUpdate.model_validate({field: None})

    assert field in payload.model_fields_set
    assert getattr(payload, field) is None


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


def test_storage_endpoint_response_requires_complete_canonical_payload() -> None:
    assert set(StorageEndpoint.model_json_schema()["required"]) == {
        "name",
        "endpoint_url",
        "region",
        "force_path_style",
        "verify_tls",
        "provider",
        "ceph_admin_allowed",
        "features",
        "latitude",
        "longitude",
        "id",
        "is_default",
        "is_editable",
        "created_at",
        "updated_at",
        "tags",
        "admin_access_key",
        "has_admin_secret",
        "service_identities",
        "ceph_admin_active",
        "capabilities",
        "admin_ops_permissions",
        "features",
    }
    schemas = app.openapi()["components"]["schemas"]
    assert set(schemas["StorageEndpointAdminOpsPermissions"]["required"]) == {
        "users_read",
        "users_write",
        "buckets_read",
        "buckets_write",
        "accounts_read",
        "accounts_write",
        "usage_read",
        "usage_write",
    }
    assert set(schemas["EndpointServiceIdentityStatus"]["required"]) == {
        "kind",
        "mode",
        "rgw_uid",
        "status",
        "credentials_configured",
        "rotation_pending",
        "rotation_phase",
        "last_error",
        "last_reconciled_at",
    }
