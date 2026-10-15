# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from app.db import PortalAdminRequest, User, UserNotification, UserRole
from app.utils.time import utcnow


ADMIN_ROLES = {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}


class PortalRequestNotificationService:
    """Create idempotent notifications for Portal request lifecycle events."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def notify_admins(self, row: PortalAdminRequest) -> None:
        admins = (
            self.db.query(User)
            .filter(User.is_active.is_(True), User.role.in_(ADMIN_ROLES))
            .all()
        )
        for admin in admins:
            self._add_notification(
                user_id=int(admin.id),
                title="New Portal request",
                message=f"{row.requester_email} submitted a Portal request.",
                event_key=f"portal_request:{row.id}:created:{admin.id}",
                severity="info",
                payload={
                    "request_id": row.id,
                    "request_type": row.request_type,
                    "account_id": row.account_id,
                },
            )

    def notify_requester(
        self,
        row: PortalAdminRequest,
        *,
        title: str,
        message: str,
        event_suffix: str,
    ) -> None:
        if not row.requester_user_id:
            return
        self._add_notification(
            user_id=int(row.requester_user_id),
            title=title,
            message=message,
            event_key=f"portal_request:{row.id}:{event_suffix}",
            severity="info" if row.status != "failed" else "warning",
            payload={
                "request_id": row.id,
                "request_type": row.request_type,
                "status": row.status,
            },
        )

    def _add_notification(
        self,
        *,
        user_id: int,
        title: str,
        message: str,
        event_key: str,
        severity: str,
        payload: dict[str, Any],
    ) -> None:
        exists = (
            self.db.query(UserNotification.id)
            .filter(
                UserNotification.user_id == int(user_id),
                UserNotification.event_key == event_key,
            )
            .first()
        )
        if exists:
            return
        self.db.add(
            UserNotification(
                user_id=int(user_id),
                notification_type="portal_request",
                severity=severity,
                title=title,
                message=message,
                subject_type=None,
                event_key=event_key,
                payload_json=json.dumps(payload, ensure_ascii=True, sort_keys=True),
                created_at=utcnow(),
            )
        )
