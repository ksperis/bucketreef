# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.manager_activity import ManagerActivityEntry


def test_manager_activity_entry_requires_complete_canonical_payload() -> None:
    assert set(ManagerActivityEntry.model_json_schema()["required"]) == {
        "id",
        "created_at",
        "action",
        "entity_type",
        "entity_id",
        "context_kind",
        "context_id",
        "context_name",
        "status",
        "user_email",
    }
