# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.portal_sharing import (
    PortalShareCandidateListingRequest,
    PortalCollaborator,
    PortalCollaboratorAccessReview,
    PortalCollaboratorsResponse,
    PortalCollaboratorStorageSpaceAccess,
    PortalCollaboratorSummary,
    PortalCollaboratorTrend,
    PortalPublicLink,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceOwner,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
    PortalStorageSpaceSharePayload,
)


def test_portal_sharing_models_have_a_single_canonical_module() -> None:
    assert PortalPublicLink.__module__ == "app.models.portal_sharing"
    assert PortalStorageSpaceAccessSummary.__module__ == "app.models.portal_sharing"


def test_portal_sharing_routes_preserve_their_openapi_contracts() -> None:
    paths = app.openapi()["paths"]

    access_summary = paths["/api/portal/storage-spaces/{space_id}/access-summary"]["get"]
    assert access_summary["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceAccessSummary"
    }

    collaborators = paths["/api/portal/collaborators"]["get"]
    assert collaborators["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalCollaboratorsResponse"
    }

    create_link = paths["/api/portal/storage-spaces/{space_id}/public-links"]["post"]
    assert create_link["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalPublicLinkCreate"
    }
    assert create_link["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalPublicLink"
    }

    create_share = paths["/api/portal/storage-spaces/{space_id}/shares"]["post"]
    assert create_share["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/PortalStorageSpaceSharePayload"
    }

    for path in (
        "/api/portal/share-candidates",
        "/api/portal/storage-spaces/{space_id}/share-candidates",
    ):
        parameters = {
            parameter["name"]: parameter
            for parameter in paths[path]["get"]["parameters"]
            if parameter["in"] == "query"
        }
        assert set(parameters) == {
            "page",
            "page_size",
            "search",
            "include_already_shared",
            "account_id",
        }
        assert parameters["page_size"]["schema"] == {
            "type": "integer",
            "maximum": 100,
            "minimum": 1,
            "default": 25,
            "title": "Page Size",
        }


def test_portal_share_candidate_request_preserves_listing_bounds() -> None:
    schema = PortalShareCandidateListingRequest.model_json_schema()["properties"]
    assert schema["page"] == {"default": 1, "minimum": 1, "title": "Page", "type": "integer"}
    assert schema["page_size"] == {
        "default": 25,
        "maximum": 100,
        "minimum": 1,
        "title": "Page Size",
        "type": "integer",
    }
    assert schema["search"]["anyOf"][0] == {"maxLength": 200, "type": "string"}


def test_portal_share_creation_requires_canonical_user_id() -> None:
    schema = PortalStorageSpaceSharePayload.model_json_schema()

    assert set(schema["properties"]) == {"user_id", "role"}
    assert set(schema["required"]) == {"user_id", "role"}


def test_portal_sharing_responses_require_complete_canonical_payloads() -> None:
    expected_required = {
        PortalStorageSpaceShare: {"user_id", "email", "role"},
        PortalStorageSpaceOwner: {"email", "display_name"},
        PortalStorageSpaceAccessSummary: {
            "mode", "default_account_member_role", "owner", "effective_member_count", "explicit_shares",
            "public_link_count", "can_manage_access", "can_create_public_links"
        },
        PortalStorageSpaceShareCandidate: {
            "user_id", "email", "display_name", "access_source", "already_shared"
        },
        PortalCollaborator: {
            "user_id", "email", "display_name", "portal_role", "access_source", "member_since", "avatar",
            "can_review_access"
        },
        PortalCollaboratorStorageSpaceAccess: {
            "storage_space_id", "storage_space_name", "role", "source", "can_revoke"
        },
        PortalCollaboratorAccessReview: {
            "collaborator", "can_request_project_removal", "can_request_role_change", "space_accesses"
        },
        PortalCollaboratorTrend: {"label", "collaborator_count"},
        PortalCollaboratorSummary: {"collaborator_count", "external_access_key_count", "trend"},
        PortalCollaboratorsResponse: {"summary", "collaborators"},
        PortalPublicLink: {
            "id", "storage_space_id", "storage_space_name", "object_name", "url", "expires_at", "status"
        },
    }
    for model, required in expected_required.items():
        assert set(model.model_json_schema()["required"]) == required
