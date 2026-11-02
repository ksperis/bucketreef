# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Cleanup and compensation for managed private-access workflows."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import ManagedPrivateAccess, User
from app.services.managed_private_access_audit_service import (
    ManagedPrivateAccessAuditService,
)
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessCleanupPending,
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessNotFound,
)
from app.services.managed_private_access_iam_service import (
    ManagedPrivateAccessIAMService,
)
from app.services.managed_private_access_remote_cleanup_service import (
    ManagedPrivateAccessRemoteCleanupService,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.s3_connections_service import S3ConnectionsService


class ManagedPrivateAccessCleanupService:
    """Own remote cleanup, retries, and provisioning compensation."""

    def __init__(
        self,
        db: Session,
        *,
        iam: ManagedPrivateAccessIAMService | None = None,
        audit: ManagedPrivateAccessAuditService | None = None,
        state: ManagedPrivateAccessStateService | None = None,
        connections: S3ConnectionsService | None = None,
        remote: ManagedPrivateAccessRemoteCleanupService | None = None,
    ) -> None:
        self.db = db
        self.audit = audit or ManagedPrivateAccessAuditService(db)
        self.connections = connections or S3ConnectionsService(db)
        state_store = state or ManagedPrivateAccessStateService(db)
        self.state = state_store
        self.remote = remote or ManagedPrivateAccessRemoteCleanupService(
            db,
            iam=iam or ManagedPrivateAccessIAMService(db),
            state=state_store,
        )

    def delete_owned_connection(self, *, user: User, connection_id: int) -> bool:
        provisioning = self.db.scalar(
            select(ManagedPrivateAccess)
            .where(
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id == connection_id,
            )
            .limit(1)
        )
        if provisioning is None:
            return False
        connection = provisioning.connection
        if connection is None:
            raise ManagedPrivateAccessConflict("Managed private access connection is already absent")

        context_id = f"conn-{connection.id}"
        purge = ResourceDeletionPurgeService(self.db)
        try:
            purge.validate_execution_context_cleanup(context_id)
        except ValueError as exc:
            raise ManagedPrivateAccessConflict(str(exc)) from exc

        connection.is_active = False
        self._cleanup_remote_or_pending(
            provisioning,
            user=user,
            pending_message="Remote cleanup failed; the managed access remains recorded for remediation",
        )

        self.db.delete(provisioning)
        domain_kind, _owner_user_id = self.connections.tags.resolve_connection_domain(connection)
        purge.purge_execution_context_data(context_id)
        self.db.delete(connection)
        self.db.flush()
        self.connections.tags.cleanup_orphan_definitions(domain_kinds=[domain_kind])
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.delete.success",
            connection_id=connection_id,
        )
        return True

    def retry_cleanup(self, *, user: User, connection_id: int) -> None:
        provisioning = self.db.scalar(
            select(ManagedPrivateAccess)
            .where(
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id == connection_id,
                ManagedPrivateAccess.state == "cleanup_pending",
            )
            .limit(1)
        )
        if provisioning is None:
            raise ManagedPrivateAccessNotFound("Managed private access cleanup not found")
        self.delete_owned_connection(user=user, connection_id=connection_id)

    def retry_provisioning_cleanup(self, *, user: User, provisioning_id: int) -> None:
        """Retry compensation when provisioning failed before a connection existed."""
        provisioning = self.db.scalar(
            select(ManagedPrivateAccess)
            .where(
                ManagedPrivateAccess.id == provisioning_id,
                ManagedPrivateAccess.owner_user_id == user.id,
                ManagedPrivateAccess.s3_connection_id.is_(None),
                ManagedPrivateAccess.state == "cleanup_pending",
            )
            .limit(1)
        )
        if provisioning is None:
            raise ManagedPrivateAccessNotFound("Managed private access provisioning cleanup not found")
        self._cleanup_remote_or_pending(
            provisioning,
            user=user,
            pending_message="Remote cleanup still requires remediation",
        )

        self.db.delete(provisioning)
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.compensation.retry.success",
        )

    def _cleanup_remote_or_pending(
        self,
        provisioning: ManagedPrivateAccess,
        *,
        user: User,
        pending_message: str,
    ) -> None:
        self.state.mark_deleting(provisioning)
        try:
            self.remote.cleanup(provisioning, user=user)
        except Exception as exc:
            cleanup_error = sanitized_error_log_detail(exc)
            self.state.mark_cleanup_pending(provisioning, cleanup_error)
            self.audit.record_cleanup_pending(user, provisioning, cleanup_error)
            raise ManagedPrivateAccessCleanupPending(
                provisioning.id,
                pending_message,
            ) from exc
