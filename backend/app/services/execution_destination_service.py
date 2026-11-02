# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Literal

from sqlalchemy.orm import Session

from app.db import S3Connection, StorageEndpoint, User
from app.services import app_settings_service
from app.services.effective_access_service import EffectiveAccessService
from app.services.feature_policy_service import (
    manager_subject_resource,
    multisite_endpoint_switching_allowed,
)
from app.services.rgw_multisite_endpoints import rgw_multisite_endpoints_compatible
from app.services.s3_execution_context import S3ExecutionContext


ExecutionDestinationErrorReason = Literal[
    "unavailable_context",
    "missing_origin",
    "temporary_credentials",
    "not_allowed",
    "destination_not_found",
    "incompatible_destination",
]


class ExecutionDestinationError(ValueError):
    def __init__(self, reason: ExecutionDestinationErrorReason) -> None:
        super().__init__(reason)
        self.reason = reason


class ExecutionDestinationService:
    """Resolve and apply an authorized RGW multisite execution destination."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def apply_user_override(
        self,
        user: User,
        execution_context: S3ExecutionContext,
        execution_endpoint_id: int,
        *,
        surface: str,
        portal_browser: bool,
        is_storage_ops_surface: bool,
    ) -> S3ExecutionContext:
        if (
            surface not in {"manager", "manager-browser", "browser"}
            or portal_browser
            or is_storage_ops_surface
            or execution_context.context_kind not in {"account", "s3_user", "connection"}
        ):
            raise ExecutionDestinationError("unavailable_context")

        origin = execution_context.storage_endpoint
        if origin is None or execution_context.storage_endpoint_id is None:
            raise ExecutionDestinationError("missing_origin")
        if execution_endpoint_id == origin.id:
            return execution_context

        if execution_context.context_kind == "connection":
            source_connection = execution_context.source_connection
            if source_connection is None and execution_context.s3_connection_id is not None:
                source_connection = self.db.get(
                    S3Connection,
                    execution_context.s3_connection_id,
                )
            if execution_context.session_token_value is not None or (
                source_connection is not None and source_connection.session_token is not None
            ):
                raise ExecutionDestinationError("temporary_credentials")

        effective = EffectiveAccessService(self.db).resolve_user(user)
        resource = manager_subject_resource(self.db, execution_context)
        policies = app_settings_service.load_app_settings_for_db_readonly(
            self.db
        ).manager.feature_policies
        if not multisite_endpoint_switching_allowed(
            policies,
            resource,
            principal_allowed=effective.allow_multisite_endpoint_switching,
        ):
            raise ExecutionDestinationError("not_allowed")

        destination = self.db.get(StorageEndpoint, execution_endpoint_id)
        if destination is None:
            raise ExecutionDestinationError("destination_not_found")
        if not rgw_multisite_endpoints_compatible(origin, destination):
            raise ExecutionDestinationError("incompatible_destination")

        execution_context.storage_endpoint_id = destination.id
        execution_context.storage_endpoint = destination
        if execution_context.context_kind == "connection":
            # Connections cache their resolved target in session_* fields.
            execution_context.session_endpoint = destination.endpoint_url
            execution_context.session_region = destination.region
            execution_context.session_force_path_style = bool(destination.force_path_style)
            execution_context.session_verify_tls = bool(destination.verify_tls)
        return execution_context
