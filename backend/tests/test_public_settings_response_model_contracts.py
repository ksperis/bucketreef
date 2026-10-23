# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.app_settings import LoginSettings
from app.models.storage_endpoint import StorageEndpointMeta, StorageEndpointPublic


def test_public_settings_responses_require_complete_canonical_payloads() -> None:
    assert set(StorageEndpointPublic.model_json_schema()["required"]) == {
        "id",
        "name",
        "endpoint_url",
        "is_default",
    }
    assert set(StorageEndpointMeta.model_json_schema()["required"]) == {
        "managed_by_env",
    }
    assert set(LoginSettings.model_json_schema()["required"]) == {
        "allow_login_access_keys",
        "allow_login_endpoint_list",
        "allow_login_custom_endpoint",
        "default_endpoint_url",
        "endpoints",
        "login_logo_url",
    }
