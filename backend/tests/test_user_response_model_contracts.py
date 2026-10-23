# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.user import UserSummary


def test_user_summary_requires_complete_canonical_payload() -> None:
    schema = UserSummary.model_json_schema()

    assert set(schema["required"]) == {
        "id",
        "email",
        "full_name",
        "avatar",
        "role",
    }
    assert "iam_username" not in schema["properties"]
