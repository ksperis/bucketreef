# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.key_rotation import (
    KeyRotationResponse,
    KeyRotationResultItem,
    KeyRotationSummary,
)


def test_key_rotation_responses_require_complete_canonical_payloads() -> None:
    assert set(KeyRotationResultItem.model_json_schema()["required"]) == {
        "endpoint_id",
        "endpoint_name",
        "key_type",
        "target_type",
        "target_id",
        "target_label",
        "status",
        "message",
        "rotation_pending",
        "rotation_phase",
        "old_access_key",
        "new_access_key",
    }
    assert set(KeyRotationSummary.model_json_schema()["required"]) == {
        "total",
        "rotated",
        "failed",
        "skipped",
        "deleted_old_keys",
        "disabled_old_keys",
    }
    assert set(KeyRotationResponse.model_json_schema()["required"]) == {
        "mode",
        "summary",
        "results",
    }
