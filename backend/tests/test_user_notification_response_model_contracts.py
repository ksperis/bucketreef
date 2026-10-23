# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from app.models.user_notification import (
    DeleteUserNotificationsResponse,
    MarkUserNotificationsReadResponse,
    UserNotificationOut,
    UserNotificationsResponse,
)


def test_user_notification_responses_require_complete_canonical_payloads() -> None:
    assert set(UserNotificationOut.model_json_schema()["required"]) == {
        "id",
        "type",
        "severity",
        "title",
        "message",
        "subject_type",
        "storage_endpoint_id",
        "s3_account_id",
        "s3_user_id",
        "payload",
        "created_at",
        "read_at",
    }
    assert set(UserNotificationsResponse.model_json_schema()["required"]) == {
        "items",
        "unread_count",
    }
    assert set(
        MarkUserNotificationsReadResponse.model_json_schema()["required"]
    ) == {
        "updated_count",
        "unread_count",
    }
    assert set(DeleteUserNotificationsResponse.model_json_schema()["required"]) == {
        "deleted_count",
        "unread_count",
    }
