# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.manager_activity import ManagerActivityEntry, ManagerActivityListingRequest


def test_manager_activity_listing_request_keeps_canonical_defaults_and_bounds() -> None:
    schema = ManagerActivityListingRequest.model_json_schema()

    assert schema["properties"]["limit"]["default"] == 5
    assert schema["properties"]["limit"]["minimum"] == 1
    assert schema["properties"]["limit"]["maximum"] == 20
    assert schema["properties"]["cursor"]["anyOf"][0]["minimum"] == 1
    assert schema["properties"]["search"]["anyOf"][0]["maxLength"] == 200


def test_manager_activity_entry_requires_complete_canonical_payload() -> None:
    assert set(ManagerActivityEntry.model_json_schema()["required"]) == {
        "id",
        "created_at",
        "action",
        "entity_type",
        "entity_id",
        "context_name",
        "status",
        "user_email",
    }
