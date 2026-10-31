# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from typing import Callable
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import ManagedPrivateAccess, User
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedPrivateAccessResult,
    ManagedRGWUserPrivateAccessRequest,
)
from app.services.resource_name_validation import validate_inline_policy_requests
from app.services.effective_access_service import EffectiveAccessService
from app.services.managed_private_access_audit_service import (
    ManagedPrivateAccessAuditService,
)
from app.services.managed_private_access_cleanup_service import (
    ManagedPrivateAccessCleanupService,
)
from app.services.managed_private_access_connection_service import (
    ManagedPrivateAccessConnectionService,
)
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessCleanupPending,
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessError,
)
from app.services.managed_private_access_iam_service import (
    ManagedPrivateAccessIAMService,
)
from app.services.managed_private_access_policy_service import (
    ManagedPrivateAccessPolicyService,
)
from app.services.managed_private_access_query_service import (
    ManagedPrivateAccessQueryService,
)
from app.services.managed_private_access_sources import (
    ManagedPrivateAccessSource,
    ManagedPrivateAccessSourceResolver,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.rgw_iam import RGWIAMService
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_context import S3ExecutionTarget
from app.services.s3_users_service import S3UsersService
from app.utils.time import utcnow


ManagedPrivateAccessRequest = ManagedIAMPrivateAccessRequest | ManagedRGWUserPrivateAccessRequest


class ManagedPrivateAccessService:
    """Orchestrate remote credentials and a private connection as a durable saga."""

    def __init__(self, db: Session) -> None:
        self.db = db
        self.access = EffectiveAccessService(db)
        self.sources = ManagedPrivateAccessSourceResolver(db, self.access)
        self.policy = ManagedPrivateAccessPolicyService(
            db,
            access=self.access,
            sources=self.sources,
        )
        connections = S3ConnectionsService(db)
        self.audit = ManagedPrivateAccessAuditService(db)
        self.queries = ManagedPrivateAccessQueryService(db)
        self.state = ManagedPrivateAccessStateService(db)
        self.iam = ManagedPrivateAccessIAMService(db, access=self.access)
        self.connection = ManagedPrivateAccessConnectionService(
            db,
            audit=self.audit,
            state=self.state,
            connections=connections,
        )
        self.cleanup = ManagedPrivateAccessCleanupService(
            db,
            iam=self.iam,
            audit=self.audit,
            state=self.state,
            connections=connections,
        )

    def provision_iam(
        self,
        *,
        user: User,
        context: S3ExecutionTarget,
        payload: ManagedIAMPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        self.policy.ensure_managed_private_connection_provisioning_allowed(user)
        validate_inline_policy_requests(payload.inline_policies, "user", context)
        source = self.sources.resolve_iam_source(user, context)
        destination = self.sources.derive_destination(source)
        iam = self.iam.for_context(context)
        self.policy.validate_iam_provisioning_request(iam, payload)
        existing_result = self._existing_result_for_source(user, source, payload)
        if existing_result is not None:
            return existing_result

        provisioning = self._start_provisioning(user, source)
        try:
            access_key_id, secret_access_key = self._provision_iam_credentials(
                provisioning,
                iam,
                payload,
                username=source.iam_username or "",
            )
            return self.connection.activate(
                user=user,
                provisioning=provisioning,
                destination=destination,
                payload=payload,
                access_key_id=access_key_id,
                secret_access_key=secret_access_key,
            )
        except ManagedPrivateAccessConflict:
            self.audit.record(
                user,
                provisioning,
                "managed_private_access.provision.failure",
                status="failure",
                message="Deterministic IAM principal conflict",
            )
            raise
        except Exception as exc:
            self._handle_provisioning_failure(
                user=user,
                provisioning_id=provisioning.id,
                exc=exc,
                compensate=lambda failure: self.cleanup.compensate_iam(
                    provisioning.id,
                    iam,
                    failure=failure,
                    user=user,
                ),
            )
            raise ManagedPrivateAccessError("Unable to create managed private access") from exc

    def provision_rgw_user(
        self,
        *,
        user: User,
        context: S3ExecutionTarget,
        payload: ManagedRGWUserPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        self.policy.ensure_managed_private_connection_provisioning_allowed(user)
        source = self.sources.resolve_rgw_user_source(user, context)
        destination = self.sources.derive_destination(source)
        existing_result = self._existing_result_for_source(user, source, payload)
        if existing_result is not None:
            return existing_result

        provisioning = self._start_provisioning(user, source)
        users = S3UsersService(self.db)
        try:
            key = users.create_access_key_entry(source.identifier)
            provisioning.access_key_id = key.access_key_id
            provisioning.created_access_key = True
            self.state.checkpoint(provisioning)
            return self.connection.activate(
                user=user,
                provisioning=provisioning,
                destination=destination,
                payload=payload,
                access_key_id=key.access_key_id,
                secret_access_key=key.secret_access_key,
            )
        except Exception as exc:
            self._handle_provisioning_failure(
                user=user,
                provisioning_id=provisioning.id,
                exc=exc,
                compensate=lambda failure: self.cleanup.compensate_rgw_user(
                    provisioning.id,
                    failure=failure,
                    user=user,
                ),
            )
            raise ManagedPrivateAccessError("Unable to create managed private access") from exc

    def _provision_iam_credentials(
        self,
        provisioning: ManagedPrivateAccess,
        iam: RGWIAMService,
        payload: ManagedIAMPrivateAccessRequest,
        *,
        username: str,
    ) -> tuple[str, str]:
        if iam.get_user(username) is not None:
            self.state.mark_failed(provisioning, "deterministic_remote_principal_exists")
            raise ManagedPrivateAccessConflict(
                "The deterministic IAM user already exists and is not linked to a known provisioning"
            )

        iam.create_user(username, create_key=False)
        provisioning.created_remote_principal = True
        self.state.checkpoint(provisioning)

        for group_name in payload.groups:
            iam.add_user_to_group(group_name, username)
            self.state.append_list_value(provisioning, "iam_groups", group_name)
            self.state.checkpoint(provisioning)
        for policy_arn in payload.managed_policies:
            iam.attach_user_policy(username, policy_arn)
            self.state.append_list_value(provisioning, "iam_managed_policies", policy_arn)
            self.state.checkpoint(provisioning)
        for inline in payload.inline_policies:
            iam.put_user_inline_policy(username, inline.name, inline.document)
            self.state.append_list_value(provisioning, "iam_inline_policy_names", inline.name)
            self.state.checkpoint(provisioning)

        key = iam.create_access_key(username)
        if not key.access_key_id or not key.secret_access_key:
            raise ManagedPrivateAccessError("RGW IAM did not return complete access credentials")
        provisioning.access_key_id = key.access_key_id
        provisioning.created_access_key = True
        self.state.checkpoint(provisioning)
        return key.access_key_id, key.secret_access_key

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

    def _existing_result_for_source(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
        payload: ManagedPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult | None:
        existing = self.queries.active_for_source(
            user.id,
            source.kind,
            source.identifier,
        )
        if existing is None:
            return None
        return self.connection.resolve_existing(existing, payload)

    def _start_provisioning(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccess:
        provisioning = self._claim(user, source)
        self.audit.record(user, provisioning, "managed_private_access.provision.start")
        return provisioning

    def _claim(
        self,
        user: User,
        source: ManagedPrivateAccessSource,
    ) -> ManagedPrivateAccess:
        row = ManagedPrivateAccess(
            owner_user_id=user.id,
            source_context_type=source.kind,
            source_context_id=source.identifier,
            remote_principal_type=source.remote_principal_type,
            remote_principal_identifier=source.remote_principal_identifier,
            iam_username=source.iam_username,
            state="provisioning",
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(row)
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            raise ManagedPrivateAccessConflict(
                "A managed private access operation already exists for this execution context"
            ) from exc
        self.db.refresh(row)
        return row
