# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Audit recording for managed private-access workflows."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import ManagedPrivateAccess, S3Account, S3Connection, S3User, User
from app.services.audit_service import AuditService
from app.services.mappers.s3_connection import mask_access_key_id
from app.services.s3_execution_context import S3ExecutionContext


class ManagedPrivateAccessAuditService:
    """Record managed private-access control-plane events without secret material."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.audit = AuditService(db)

    def record(
        self,
        user: User,
        provisioning: ManagedPrivateAccess,
        action: str,
        *,
        status: str = "success",
        message: str | None = None,
        connection_id: int | None = None,
    ) -> None:
        self.audit.record_action(
            user=user,
            scope="manager",
            action=action,
            entity_type="managed_private_access",
            entity_id=str(provisioning.id),
            execution_context=self._execution_context(provisioning),
            status=status,
            message=message,
            metadata={
                "source_context_type": provisioning.source_context_type,
                "source_context_id": provisioning.source_context_id,
                "remote_principal_type": provisioning.remote_principal_type,
                "remote_principal_identifier": provisioning.remote_principal_identifier,
                "iam_username": provisioning.iam_username,
                "access_key_id": mask_access_key_id(provisioning.access_key_id),
                "connection_id": connection_id or provisioning.s3_connection_id,
                "provisioning_state": provisioning.state,
            },
        )

    def _execution_context(
        self,
        provisioning: ManagedPrivateAccess,
    ) -> S3ExecutionContext | None:
        source_id = provisioning.source_context_id
        if provisioning.source_context_type == "account":
            account = self.db.get(S3Account, source_id)
            return S3ExecutionContext.from_account(account) if account is not None else None
        if provisioning.source_context_type == "s3_user":
            s3_user = self.db.get(S3User, source_id)
            return S3ExecutionContext.from_s3_user(s3_user) if s3_user is not None else None
        if provisioning.source_context_type == "connection":
            connection = self.db.get(S3Connection, source_id)
            return S3ExecutionContext.from_connection(connection) if connection is not None else None
        return None
