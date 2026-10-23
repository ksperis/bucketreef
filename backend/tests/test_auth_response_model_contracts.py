# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.api_token import ApiTokenCreateResponse, ApiTokenInfo
from app.models.auth import RefreshResponse


def test_api_token_responses_require_complete_canonical_payloads() -> None:
    assert set(ApiTokenInfo.model_json_schema()["required"]) == {
        "id",
        "name",
        "created_at",
        "last_used_at",
        "expires_at",
        "revoked_at",
        "scopes",
    }
    assert set(ApiTokenCreateResponse.model_json_schema()["required"]) == {
        "access_token",
        "token_type",
        "api_token",
    }


def test_refresh_response_requires_explicit_status() -> None:
    assert set(RefreshResponse.model_json_schema()["required"]) == {"status"}
