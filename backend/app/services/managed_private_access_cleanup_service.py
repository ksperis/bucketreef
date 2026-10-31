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
    ManagedPrivateAccessError,
    ManagedPrivateAccessNotFound,
)
from app.services.managed_private_access_iam_service import (
    ManagedPrivateAccessIAMService,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_iam import RGWIAMService
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_users_service import S3UsersService
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
        self.iam = iam or ManagedPrivateAccessIAMService(db)
        self.audit = audit or ManagedPrivateAccessAuditService(db)
        self.state = state or ManagedPrivateAccessStateService(db)
        self.connections = connections or S3ConnectionsService(db)

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

    def compensate_iam(
        self,
        provisioning_id: int,
        iam: RGWIAMService,
        *,
        failure: str,
        user: User,
    ) -> None:
        self._compensate(
            provisioning_id,
            cleanup=lambda provisioning: self._cleanup_iam_resources(provisioning, iam),
            failure=failure,
            user=user,
        )

    def compensate_rgw_user(
        self,
        provisioning_id: int,
        *,
        failure: str,
        user: User,
    ) -> None:
        def cleanup(provisioning: ManagedPrivateAccess) -> None:
            if provisioning.created_access_key and provisioning.access_key_id:
                S3UsersService(self.db).delete_key(
                    provisioning.source_context_id,
                    provisioning.access_key_id,
                )

        self._compensate(
            provisioning_id,
            cleanup=cleanup,
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
            self._cleanup_remote(provisioning, user=user)
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

    def _cleanup_remote(self, provisioning: ManagedPrivateAccess, *, user: User) -> None:
        if provisioning.remote_principal_type == "iam_user":
            iam = self.iam.for_source(provisioning, user)
            self._cleanup_iam_resources(provisioning, iam)
            return

        users = S3UsersService(self.db)
        if provisioning.created_access_key and provisioning.access_key_id:
            users.delete_key(provisioning.source_context_id, provisioning.access_key_id)
            provisioning.created_access_key = False
            self.state.checkpoint(provisioning)

    def _cleanup_iam_resources(
        self,
        provisioning: ManagedPrivateAccess,
        iam: RGWIAMService,
    ) -> None:
        username = provisioning.iam_username or provisioning.remote_principal_identifier
        errors: list[str] = []

        def attempt(operation: Callable[[], None], on_success: Callable[[], None]) -> None:
            try:
                operation()
                on_success()
                self.state.checkpoint(provisioning)
            except Exception as exc:
                errors.append(sanitized_error_log_detail(exc))

        if provisioning.created_access_key and provisioning.access_key_id:
            attempt(
                lambda: iam.delete_access_key(username, provisioning.access_key_id or ""),
                lambda: setattr(provisioning, "created_access_key", False),
            )
        for name in reversed(self.state.string_list(provisioning.iam_inline_policy_names)):
            attempt(
                lambda name=name: iam.delete_user_inline_policy(username, name),
                lambda name=name: self.state.remove_list_value(
                    provisioning,
                    "iam_inline_policy_names",
                    name,
                ),
            )
        for arn in reversed(self.state.string_list(provisioning.iam_managed_policies)):
            attempt(
                lambda arn=arn: iam.detach_user_policy(username, arn),
                lambda arn=arn: self.state.remove_list_value(
                    provisioning,
                    "iam_managed_policies",
                    arn,
                ),
            )
        for group in reversed(self.state.string_list(provisioning.iam_groups)):
            attempt(
                lambda group=group: iam.remove_user_from_group(group, username),
                lambda group=group: self.state.remove_list_value(
                    provisioning,
                    "iam_groups",
                    group,
                ),
            )
        if provisioning.created_remote_principal:
            attempt(
                lambda: iam.delete_user(username),
                lambda: setattr(provisioning, "created_remote_principal", False),
            )
        if errors:
            raise ManagedPrivateAccessError("; ".join(errors))

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
