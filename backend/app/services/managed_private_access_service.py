# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import User
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
from app.services.managed_private_access_compensation_service import (
    ManagedPrivateAccessCompensationService,
)
from app.services.managed_private_access_connection_service import (
    ManagedPrivateAccessConnectionService,
)
from app.services.managed_private_access_credential_service import (
    ManagedPrivateAccessCredentialService,
)
from app.services.managed_private_access_destination_service import (
    ManagedPrivateAccessDestinationService,
)
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessError,
)
from app.services.managed_private_access_iam_service import (
    ManagedPrivateAccessIAMService,
)
from app.services.managed_private_access_iam_source_service import (
    ManagedPrivateAccessIAMSourceService,
)
from app.services.managed_private_access_lifecycle_service import (
    ManagedPrivateAccessLifecycleService,
)
from app.services.managed_private_access_policy_service import (
    ManagedPrivateAccessPolicyService,
)
from app.services.managed_private_access_remote_cleanup_service import (
    ManagedPrivateAccessRemoteCleanupService,
)
from app.services.managed_private_access_rgw_user_source_service import (
    ManagedPrivateAccessRGWUserSourceService,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.s3_connections_service import S3ConnectionsService
from app.services.s3_execution_context import S3ExecutionTarget


class ManagedPrivateAccessService:
    """Orchestrate remote credentials and a private connection as a durable saga."""

    def __init__(self, db: Session) -> None:
        self.access = EffectiveAccessService(db)
        self.iam_sources = ManagedPrivateAccessIAMSourceService(db, self.access)
        self.rgw_user_sources = ManagedPrivateAccessRGWUserSourceService(db, self.access)
        self.destinations = ManagedPrivateAccessDestinationService(db)
        self.policy = ManagedPrivateAccessPolicyService(
            db,
            access=self.access,
            rgw_user_sources=self.rgw_user_sources,
        )
        connections = S3ConnectionsService(db)
        self.audit = ManagedPrivateAccessAuditService(db)
        state = ManagedPrivateAccessStateService(db)
        self.iam = ManagedPrivateAccessIAMService(db, access=self.access)
        self.credentials = ManagedPrivateAccessCredentialService(db, state=state)
        self.connection = ManagedPrivateAccessConnectionService(
            db,
            audit=self.audit,
            state=state,
            connections=connections,
        )
        remote_cleanup = ManagedPrivateAccessRemoteCleanupService(
            db,
            iam=self.iam,
            state=state,
        )
        self.lifecycle = ManagedPrivateAccessLifecycleService(
            db,
            audit=self.audit,
            state=state,
            connection=self.connection,
        )
        self.cleanup = ManagedPrivateAccessCleanupService(
            db,
            iam=self.iam,
            audit=self.audit,
            state=state,
            connections=connections,
            remote=remote_cleanup,
        )
        self.compensation = ManagedPrivateAccessCompensationService(
            db,
            audit=self.audit,
            state=state,
            remote=remote_cleanup,
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
        source = self.iam_sources.resolve(user, context)
        destination = self.destinations.resolve(source)
        iam = self.iam.for_context(context)
        self.policy.validate_iam_provisioning_request(iam, payload)
        existing_result = self.lifecycle.existing_result_for_source(user, source, payload)
        if existing_result is not None:
            return existing_result

        provisioning = self.lifecycle.start(user, source)
        try:
            access_key_id, secret_access_key = self.credentials.provision_iam(
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
            self.compensation.handle_iam_provisioning_failure(
                user=user,
                provisioning_id=provisioning.id,
                iam=iam,
                exc=exc,
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
        source = self.rgw_user_sources.resolve(user, context)
        destination = self.destinations.resolve(source)
        existing_result = self.lifecycle.existing_result_for_source(user, source, payload)
        if existing_result is not None:
            return existing_result

        provisioning = self.lifecycle.start(user, source)
        try:
            access_key_id, secret_access_key = self.credentials.provision_rgw_user(
                provisioning,
                source_id=source.identifier,
            )
            return self.connection.activate(
                user=user,
                provisioning=provisioning,
                destination=destination,
                payload=payload,
                access_key_id=access_key_id,
                secret_access_key=secret_access_key,
            )
        except Exception as exc:
            self.compensation.handle_rgw_user_provisioning_failure(
                user=user,
                provisioning_id=provisioning.id,
                exc=exc,
            )
            raise ManagedPrivateAccessError("Unable to create managed private access") from exc
