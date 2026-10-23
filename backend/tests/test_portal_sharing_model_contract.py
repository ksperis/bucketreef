# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.main import app
from app.models.portal_sharing import (
    PortalCollaborator,
    PortalCollaboratorAccessReview,
    PortalCollaboratorsResponse,
    PortalCollaboratorStorageSpaceAccess,
    PortalCollaboratorSummary,
    PortalCollaboratorTrend,
    PortalPublicLink,
    PortalStorageSpaceAccessPerson,
    PortalStorageSpaceAccessSummary,
    PortalStorageSpaceShare,
    PortalStorageSpaceShareCandidate,
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


def test_portal_sharing_responses_require_complete_canonical_payloads() -> None:
    expected_required = {
        PortalStorageSpaceShare: {
            "id", "storage_space_id", "storage_space_name", "user_id", "email", "role", "direction", "activity_label"
        },
        PortalStorageSpaceAccessPerson: {
            "user_id", "email", "display_name", "role", "portal_role", "access_source", "avatar"
        },
        PortalStorageSpaceAccessSummary: {
            "mode", "default_account_member_role", "owner", "effective_member_count", "explicit_shares",
            "public_link_count", "can_manage_access", "can_create_public_links"
        },
        PortalStorageSpaceShareCandidate: {
            "user_id", "email", "display_name", "portal_role", "access_source", "already_shared", "avatar"
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
        PortalCollaboratorTrend: {"window", "label", "period_start", "collaborator_count"},
        PortalCollaboratorSummary: {"collaborator_count", "external_access_key_count", "trend"},
        PortalCollaboratorsResponse: {"summary", "collaborators"},
        PortalPublicLink: {
            "id", "storage_space_id", "storage_space_name", "object_key", "object_name", "url", "label",
            "created_by_email", "created_at", "expires_at", "revoked_at", "status"
        },
    }
    for model, required in expected_required.items():
        assert set(model.model_json_schema()["required"]) == required
