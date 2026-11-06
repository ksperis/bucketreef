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

    @staticmethod
    def _require_available_context(
        execution_context: S3ExecutionContext,
        *,
        surface: str,
        portal_browser: bool,
        is_storage_ops_surface: bool,
    ) -> None:
        if (
            surface not in {"manager", "manager-browser", "browser"}
            or portal_browser
            or is_storage_ops_surface
            or execution_context.context_kind not in {"account", "s3_user", "connection"}
        ):
            raise ExecutionDestinationError("unavailable_context")

    @staticmethod
    def _origin_endpoint(execution_context: S3ExecutionContext) -> StorageEndpoint:
        origin = execution_context.storage_endpoint
        if origin is None or execution_context.storage_endpoint_id is None:
            raise ExecutionDestinationError("missing_origin")
        return origin

    def _require_persistent_connection_credentials(
        self,
        execution_context: S3ExecutionContext,
    ) -> None:
        if execution_context.context_kind != "connection":
            return
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

    def _require_switching_allowed(
        self,
        user: User,
        execution_context: S3ExecutionContext,
    ) -> None:
        effective = EffectiveAccessService(self.db).resolve_user(user)
        resource = manager_subject_resource(self.db, execution_context)
        policies = app_settings_service.load_app_settings_for_db(
            self.db
        ).manager.feature_policies
        if not multisite_endpoint_switching_allowed(
            policies,
            resource,
            principal_allowed=effective.allow_multisite_endpoint_switching,
        ):
            raise ExecutionDestinationError("not_allowed")

    def _compatible_destination(
        self,
        origin: StorageEndpoint,
        execution_endpoint_id: int,
    ) -> StorageEndpoint:
        destination = self.db.get(StorageEndpoint, execution_endpoint_id)
        if destination is None:
            raise ExecutionDestinationError("destination_not_found")
        if not rgw_multisite_endpoints_compatible(origin, destination):
            raise ExecutionDestinationError("incompatible_destination")
        return destination

    @staticmethod
    def _apply_destination(
        execution_context: S3ExecutionContext,
        destination: StorageEndpoint,
    ) -> S3ExecutionContext:
        execution_context.storage_endpoint_id = destination.id
        execution_context.storage_endpoint = destination
        if execution_context.context_kind == "connection":
            # Connections cache their resolved target in session_* fields.
            execution_context.session_endpoint = destination.endpoint_url
            execution_context.session_region = destination.region
            execution_context.session_force_path_style = destination.force_path_style
            execution_context.session_verify_tls = destination.verify_tls
        return execution_context

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
        self._require_available_context(
            execution_context,
            surface=surface,
            portal_browser=portal_browser,
            is_storage_ops_surface=is_storage_ops_surface,
        )
        origin = self._origin_endpoint(execution_context)
        if execution_endpoint_id == origin.id:
            return execution_context
        self._require_persistent_connection_credentials(execution_context)
        self._require_switching_allowed(user, execution_context)
        destination = self._compatible_destination(origin, execution_endpoint_id)
        return self._apply_destination(execution_context, destination)
