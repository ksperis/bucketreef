# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.manager_activity import ManagerActivityEntry, ManagerActivityListingRequest
from app.services.app_settings_service import load_app_settings_for_db
from app.services.audit_service import AuditService
from app.services.feature_policy_service import manager_activity_resource, manager_activity_state
from app.services.s3_execution_context import S3ExecutionContext


class ManagerActivityUnavailableError(RuntimeError):
    pass


class ManagerActivityDisabledError(RuntimeError):
    pass


class ManagerActivityService:
    def __init__(self, db: Session, audit_service: AuditService) -> None:
        self.db = db
        self.audit_service = audit_service

    def list_activity(
        self,
        context: S3ExecutionContext,
        request: ManagerActivityListingRequest,
    ) -> list[ManagerActivityEntry]:
        resource = manager_activity_resource(self.db, context)
        if resource is None:
            raise ManagerActivityUnavailableError

        settings = load_app_settings_for_db(self.db)
        state = manager_activity_state(settings.manager.feature_policies, resource)
        if not state.enabled:
            raise ManagerActivityDisabledError

        logs = self.audit_service.list_logs(
            limit=request.limit,
            scope="manager",
            context_kind=context.context_kind,
            context_id=context.context_id,
            cursor=request.cursor,
            search=request.search,
            status=request.status,
            search_mode="manager_activity",
        )
        return [
            ManagerActivityEntry(
                id=log.id,
                created_at=log.created_at,
                action=log.action,
                entity_type=log.entity_type,
                entity_id=log.entity_id,
                context_name=log.context_name,
                status=log.status,
                user_email=log.user_email,
            )
            for log in logs
        ]
