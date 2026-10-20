# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from datetime import datetime
import json
from typing import Any, Iterable, Optional

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import (
    ManagerAccountRole,
    PortalAccountRole,
    User,
    UserNotification,
    UserRole,
)
from app.models.user_notification import UserNotificationOut, UserNotificationsResponse
from app.services.effective_access_service import EffectiveAccessService
from app.utils.time import utcnow


def _parse_notification_payload(raw: str) -> dict[str, Any]:
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("User notification payload must be a JSON object")
    return payload


class UserNotificationsService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_notifications(
        self,
        *,
        user_ids: Iterable[int],
        notification_type: str,
        event_key: str,
        title: str,
        message: str,
        severity: str,
        payload: dict[str, Any],
        created_at: datetime,
        subject_type: Optional[str] = None,
        storage_endpoint_id: Optional[int] = None,
        s3_account_id: Optional[int] = None,
        s3_user_id: Optional[int] = None,
    ) -> int:
        """Create one idempotent notification per user for a shared event."""
        created = 0
        clean_user_ids = sorted(
            {int(user_id) for user_id in user_ids if int(user_id) > 0}
        )
        if not clean_user_ids:
            return 0

        existing_user_ids = {
            int(user_id)
            for user_id in self.db.scalars(
                select(UserNotification.user_id).where(
                    UserNotification.user_id.in_(clean_user_ids),
                    UserNotification.event_key == event_key,
                )
            ).all()
        }
        payload_json = json.dumps(payload, ensure_ascii=True, sort_keys=True)
        for user_id in clean_user_ids:
            if user_id in existing_user_ids:
                continue
            row = UserNotification(
                user_id=user_id,
                notification_type=notification_type,
                severity=severity,
                title=title,
                message=message,
                subject_type=subject_type,
                storage_endpoint_id=storage_endpoint_id,
                s3_account_id=s3_account_id,
                s3_user_id=s3_user_id,
                event_key=event_key,
                payload_json=payload_json,
                created_at=created_at,
            )
            try:
                with self.db.begin_nested():
                    self.db.add(row)
                    self.db.flush()
            except IntegrityError:
                continue
            created += 1
        return created

    def create_quota_alert_notifications(
        self,
        *,
        user_ids: Iterable[int],
        subject_type: str,
        subject_id: int,
        storage_endpoint_id: int,
        event_key: str,
        title: str,
        message: str,
        severity: str,
        payload: dict[str, Any],
        created_at: datetime,
    ) -> int:
        return self.create_notifications(
            user_ids=user_ids,
            notification_type="quota_alert",
            severity=severity,
            title=title,
            message=message,
            subject_type=subject_type,
            storage_endpoint_id=storage_endpoint_id,
            s3_account_id=subject_id if subject_type == "account" else None,
            s3_user_id=subject_id if subject_type == "s3_user" else None,
            event_key=event_key,
            payload=payload,
            created_at=created_at,
        )

    def list_for_user(self, user: User, *, limit: int = 20) -> UserNotificationsResponse:
        visible = self._visible_notifications_statement(user)
        items = self.db.scalars(
            visible.order_by(
                UserNotification.created_at.desc(), UserNotification.id.desc()
            ).limit(max(1, min(int(limit), 100)))
        ).all()
        unread_count = int(
            self.db.scalar(
                select(func.count()).select_from(
                    visible.where(UserNotification.read_at.is_(None)).subquery()
                )
            )
            or 0
        )
        return UserNotificationsResponse(
            items=[self._to_out(item) for item in items],
            unread_count=unread_count,
        )

    def mark_read(
        self,
        user: User,
        *,
        notification_ids: Optional[list[int]] = None,
        mark_all: bool = False,
    ) -> int:
        visible = self._visible_notifications_statement(user).where(
            UserNotification.read_at.is_(None)
        )
        if not mark_all:
            ids = [int(item) for item in notification_ids or [] if int(item) > 0]
            if not ids:
                return 0
            visible = visible.where(UserNotification.id.in_(ids))

        now = utcnow()
        rows = self.db.scalars(visible).all()
        for row in rows:
            row.read_at = now
        self.db.commit()
        return len(rows)

    def unread_count_for_user(self, user: User) -> int:
        return int(
            self.db.scalar(
                select(func.count()).select_from(
                    self._visible_notifications_statement(user)
                    .where(UserNotification.read_at.is_(None))
                    .subquery()
                )
            )
            or 0
        )

    def delete_for_user(
        self,
        user: User,
        *,
        notification_id: Optional[int] = None,
        read_only: bool = False,
    ) -> int:
        visible = self._visible_notifications_statement(user)
        if notification_id is not None:
            visible = visible.where(UserNotification.id == int(notification_id))
        elif read_only:
            visible = visible.where(UserNotification.read_at.isnot(None))
        else:
            return 0

        visible_ids = visible.with_only_columns(UserNotification.id)
        deleted = self.db.execute(
            delete(UserNotification)
            .where(UserNotification.id.in_(visible_ids))
            .execution_options(synchronize_session=False)
        ).rowcount
        if deleted:
            self.db.commit()
        return int(deleted or 0)

    def _visible_notifications_statement(self, user: User):
        statement = select(UserNotification).where(UserNotification.user_id == user.id)
        access = EffectiveAccessService(self.db).resolve_user(user)
        alert_account_ids = {
            int(link.account_id)
            for link in access.account_links
            if (
                link.manager_role
                == ManagerAccountRole.ACCOUNT_ADMINISTRATOR.value
                or link.portal_role == PortalAccountRole.PORTAL_MANAGER.value
            )
        }
        alert_s3_user_ids = {int(item) for item in access.s3_user_ids}
        global_watch = bool(
            user.is_active
            and user.quota_alerts_global_watch
            and user.role in {UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value}
        )

        visibility_filters = [UserNotification.subject_type.is_(None)]
        if user.is_active and user.role in {
            UserRole.UI_ADMIN.value,
            UserRole.UI_SUPERADMIN.value,
        }:
            visibility_filters.append(
                UserNotification.subject_type.in_(["endpoint", "identity_request"])
            )
        if global_watch:
            visibility_filters.append(UserNotification.subject_type.in_(["account", "s3_user"]))
        else:
            if alert_account_ids:
                visibility_filters.append(
                    (UserNotification.subject_type == "account")
                    & UserNotification.s3_account_id.in_(alert_account_ids)
                )
            if alert_s3_user_ids:
                visibility_filters.append(
                    (UserNotification.subject_type == "s3_user")
                    & UserNotification.s3_user_id.in_(alert_s3_user_ids)
                )

        return statement.where(or_(*visibility_filters))

    def _to_out(self, row: UserNotification) -> UserNotificationOut:
        return UserNotificationOut(
            id=int(row.id),
            type=row.notification_type,
            severity=row.severity,
            title=row.title,
            message=row.message,
            subject_type=row.subject_type,
            storage_endpoint_id=row.storage_endpoint_id,
            s3_account_id=row.s3_account_id,
            s3_user_id=row.s3_user_id,
            payload=_parse_notification_payload(row.payload_json),
            created_at=row.created_at,
            read_at=row.read_at,
        )
