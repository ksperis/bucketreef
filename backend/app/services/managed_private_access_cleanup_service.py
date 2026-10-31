# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Cleanup and compensation for managed private-access workflows."""

from __future__ import annotations

from typing import Callable

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
from app.services.rgw_iam import RGWIAMService
from app.services.s3_connections_service import S3ConnectionsService
from app.utils.time import utcnow


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
    ) -> None:
        self.db = db
        self.audit = audit or ManagedPrivateAccessAuditService(db)
        self.connections = connections or S3ConnectionsService(db)
        iam_resolver = iam or ManagedPrivateAccessIAMService(db)
        state_store = state or ManagedPrivateAccessStateService(db)
        self.remote = ManagedPrivateAccessRemoteCleanupService(
            db,
            iam=iam_resolver,
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

    def handle_iam_provisioning_failure(
        self,
        *,
        user: User,
        provisioning_id: int,
        iam: RGWIAMService,
        exc: Exception,
    ) -> None:
        self._handle_provisioning_failure(
            user=user,
            provisioning_id=provisioning_id,
            exc=exc,
            compensate=lambda failure: self._compensate_iam(
                provisioning_id,
                iam,
                failure=failure,
                user=user,
            ),
        )

    def handle_rgw_user_provisioning_failure(
        self,
        *,
        user: User,
        provisioning_id: int,
        exc: Exception,
    ) -> None:
        self._handle_provisioning_failure(
            user=user,
            provisioning_id=provisioning_id,
            exc=exc,
            compensate=lambda failure: self._compensate_rgw_user(
                provisioning_id,
                failure=failure,
                user=user,
            ),
        )

    def _handle_provisioning_failure(
        self,
        *,
        user: User,
        provisioning_id: int,
        exc: Exception,
        compensate: Callable[[str], None],
    ) -> None:
        safe_error = sanitized_error_log_detail(exc)
        self.db.rollback()
        failed = self.db.get(ManagedPrivateAccess, provisioning_id)
        if failed is not None:
            self.audit.record(
                user,
                failed,
                "managed_private_access.provision.failure",
                status="failure",
                message=safe_error,
            )
        compensate(safe_error)
        pending = self.db.get(ManagedPrivateAccess, provisioning_id)
        if pending is not None and pending.state == "cleanup_pending":
            raise ManagedPrivateAccessCleanupPending(
                pending.id,
                "Provisioning failed and remote cleanup requires remediation",
            ) from exc

    def _compensate_iam(
        self,
        provisioning_id: int,
        iam: RGWIAMService,
        *,
        failure: str,
        user: User,
    ) -> None:
        self._compensate(
            provisioning_id,
            cleanup=lambda provisioning: self.remote.cleanup_iam_resources(provisioning, iam),
            failure=failure,
            user=user,
        )

    def _compensate_rgw_user(
        self,
        provisioning_id: int,
        *,
        failure: str,
        user: User,
    ) -> None:
        self._compensate(
            provisioning_id,
            cleanup=self.remote.cleanup_rgw_user_resources,
            failure=failure,
            user=user,
        )

    def _cleanup_remote_or_pending(
        self,
        provisioning: ManagedPrivateAccess,
        *,
        user: User,
        pending_message: str,
    ) -> None:
        provisioning.state = "deleting"
        provisioning.updated_at = utcnow()
        self.db.commit()
        try:
            self.remote.cleanup(provisioning, user=user)
        except Exception as exc:
            self._set_cleanup_pending(
                provisioning,
                sanitized_error_log_detail(exc),
                user=user,
            )
            raise ManagedPrivateAccessCleanupPending(
                provisioning.id,
                pending_message,
            ) from exc

    def _compensate(
        self,
        provisioning_id: int,
        *,
        cleanup: Callable[[ManagedPrivateAccess], None],
        failure: str,
        user: User,
    ) -> None:
        provisioning = self.db.get(ManagedPrivateAccess, provisioning_id)
        if provisioning is None:
            return
        try:
            cleanup(provisioning)
        except Exception as cleanup_exc:
            cleanup_error = sanitized_error_log_detail(cleanup_exc)
            self.audit.record(
                user,
                provisioning,
                "managed_private_access.compensation.failure",
                status="failure",
                message=cleanup_error,
            )
            self._set_cleanup_pending(provisioning, cleanup_error, user=user)
            return

        provisioning.state = "failed"
        provisioning.cleanup_error = failure
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.compensation.success",
            status="failure",
            message=failure,
        )

    def _set_cleanup_pending(
        self,
        provisioning: ManagedPrivateAccess,
        error: str,
        *,
        user: User,
    ) -> None:
        provisioning.state = "cleanup_pending"
        provisioning.cleanup_error = error
        provisioning.updated_at = utcnow()
        self.db.commit()
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.cleanup_pending",
            status="failure",
            message=error,
        )
