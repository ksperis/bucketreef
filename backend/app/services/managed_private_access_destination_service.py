# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Destination resolution for managed private-access connections."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3Account, S3Connection, S3User
from app.services.managed_private_access_errors import ManagedPrivateAccessError
from app.services.managed_private_access_sources import ManagedPrivateAccessSource
from app.services.s3_connection_endpoint_planner import S3ConnectionEndpointPlan
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.s3_endpoint import validate_user_supplied_s3_endpoint


ManagedPrivateAccessDestination = S3ConnectionEndpointPlan


class ManagedPrivateAccessDestinationService:
    """Resolve the persisted endpoint plan for a managed private connection."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def resolve(
        self,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccessDestination:
        if source.kind == "account":
            row = self.db.scalar(
                select(S3Account).where(S3Account.id == source.identifier)
            )
            return self._stored_source_destination(
                row,
                error_message="The source account has no usable storage endpoint",
            )
        if source.kind == "s3_user":
            row = self.db.scalar(
                select(S3User).where(S3User.id == source.identifier)
            )
            return self._stored_source_destination(
                row,
                error_message="The source RGW User has no usable storage endpoint",
            )
        return self._connection_destination(source.identifier)

    @staticmethod
    def _stored_source_destination(
        row: S3Account | S3User | None,
        *,
        error_message: str,
    ) -> ManagedPrivateAccessDestination:
        endpoint_id = row.storage_endpoint_id if row is not None else None
        if endpoint_id is None or row is None or row.storage_endpoint is None:
            raise ManagedPrivateAccessError(error_message)
        return ManagedPrivateAccessDestination.managed(endpoint_id)

    def _connection_destination(self, connection_id: int) -> ManagedPrivateAccessDestination:
        connection = self.db.scalar(
            select(S3Connection).where(S3Connection.id == connection_id)
        )
        if connection is None:
            raise ManagedPrivateAccessError("Source connection not found")
        if connection.storage_endpoint_id is not None:
            if connection.storage_endpoint is None:
                raise ManagedPrivateAccessError(
                    "The source connection endpoint is unavailable"
                )
            return ManagedPrivateAccessDestination.managed(connection.storage_endpoint_id)
        details = resolve_connection_details(connection)
        try:
            endpoint_url = validate_user_supplied_s3_endpoint(
                (details.endpoint_url or "").strip(),
                field_name="Endpoint URL",
            )
        except ValueError as exc:
            raise ManagedPrivateAccessError(
                sanitized_error_log_detail(exc)
            ) from exc
        if not details.verify_tls:
            raise ManagedPrivateAccessError(
                "Managed private access requires TLS verification"
            )
        return ManagedPrivateAccessDestination.custom(
            endpoint_url,
            details.region,
            details.force_path_style,
            details.verify_tls,
            details.provider,
        )
