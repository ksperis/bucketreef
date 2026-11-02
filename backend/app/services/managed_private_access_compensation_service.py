# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Provisioning failure compensation for managed private access."""

from __future__ import annotations

from typing import Callable

from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import ManagedPrivateAccess, User
from app.services.managed_private_access_audit_service import (
    ManagedPrivateAccessAuditService,
)
from app.services.managed_private_access_errors import ManagedPrivateAccessCleanupPending
from app.services.managed_private_access_remote_cleanup_service import (
    ManagedPrivateAccessRemoteCleanupService,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.rgw_iam import RGWIAMService


class ManagedPrivateAccessCompensationService:
    """Compensate remote mutations after managed provisioning fails."""

    def __init__(
        self,
        db: Session,
        *,
        audit: ManagedPrivateAccessAuditService | None = None,
        state: ManagedPrivateAccessStateService | None = None,
        remote: ManagedPrivateAccessRemoteCleanupService | None = None,
    ) -> None:
        self.db = db
        self.audit = audit or ManagedPrivateAccessAuditService(db)
        self.state = state or ManagedPrivateAccessStateService(db)
        self.remote = remote or ManagedPrivateAccessRemoteCleanupService(
            db,
            state=self.state,
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
            compensate=lambda failure: self._compensate(
                provisioning_id,
                cleanup=lambda provisioning: self.remote.cleanup_iam_resources(
                    provisioning,
                    iam,
                ),
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
            compensate=lambda failure: self._compensate(
                provisioning_id,
                cleanup=self.remote.cleanup_rgw_user_resources,
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
            self.state.mark_cleanup_pending(provisioning, cleanup_error)
            self.audit.record_cleanup_pending(user, provisioning, cleanup_error)
            return

        self.state.mark_failed(provisioning, failure)
        self.audit.record(
            user,
            provisioning,
            "managed_private_access.compensation.success",
            status="failure",
            message=failure,
        )
