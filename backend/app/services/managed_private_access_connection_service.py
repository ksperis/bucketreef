# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Local S3 connection lifecycle for managed private access."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.db import ManagedPrivateAccess, S3Account, S3Connection, User
from app.models.managed_private_access import (
    ManagedIAMPrivateAccessRequest,
    ManagedPrivateAccessResult,
    ManagedRGWUserPrivateAccessRequest,
)
from app.services.managed_private_access_audit_service import (
    ManagedPrivateAccessAuditService,
)
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessError,
)
from app.services.managed_private_access_destination_service import (
    ManagedPrivateAccessDestination,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.s3_connection_capabilities_service import (
    refresh_connection_detected_capabilities,
)
from app.services.s3_connections_service import S3ConnectionsService
from app.utils.connection_rgw_identity import normalize_connection_rgw_identity
from app.utils.rgw_payloads import extract_rgw_user_identity
from app.utils.time import utcnow


ManagedPrivateAccessRequest = ManagedIAMPrivateAccessRequest | ManagedRGWUserPrivateAccessRequest


class ManagedPrivateAccessConnectionService:
    """Persist and serialize the local connection owned by a managed-access saga."""

    def __init__(
        self,
        db: Session,
        *,
        audit: ManagedPrivateAccessAuditService | None = None,
        state: ManagedPrivateAccessStateService | None = None,
        connections: S3ConnectionsService | None = None,
    ) -> None:
        self.db = db
        self.audit = audit or ManagedPrivateAccessAuditService(db)
        self.state = state or ManagedPrivateAccessStateService(db)
        self.connections = connections or S3ConnectionsService(db)

    def resolve_existing(
        self,
        provisioning: ManagedPrivateAccess,
        payload: ManagedPrivateAccessRequest,
    ) -> ManagedPrivateAccessResult:
        connection = provisioning.connection
        if provisioning.state == "active" and connection is not None:
            same_request = (
                connection.name == payload.connection_name
                and bool(connection.access_browser) == bool(payload.access_browser)
                and bool(connection.access_manager) == bool(payload.access_manager)
            )
            if isinstance(payload, ManagedIAMPrivateAccessRequest):
                same_request = same_request and self.state.string_list(
                    provisioning.iam_groups
                ) == payload.groups
                same_request = same_request and self.state.string_list(
                    provisioning.iam_managed_policies
                ) == payload.managed_policies
                same_request = same_request and self.state.string_list(
                    provisioning.iam_inline_policy_names
                ) == [policy.name for policy in payload.inline_policies]
            if same_request:
                return ManagedPrivateAccessResult(
                    provisioning_id=provisioning.id,
                    status="active",
                    connection=self.connections.serialize(connection),
                )
        raise ManagedPrivateAccessConflict(
            "A managed private access already exists or requires cleanup for this execution context"
        )

    def activate(
        self,
        *,
        user: User,
        provisioning: ManagedPrivateAccess,
        destination: ManagedPrivateAccessDestination,
        payload: ManagedPrivateAccessRequest,
        access_key_id: str,
        secret_access_key: str,
    ) -> ManagedPrivateAccessResult:
        rgw_user_uid, rgw_tenant, rgw_account_id = self._rgw_identity(provisioning)
        connection = S3Connection(
            created_by_user_id=user.id,
            name=payload.connection_name,
            is_shared=False,
            is_active=True,
            access_manager=payload.access_manager,
            access_browser=payload.access_browser,
            server_managed=True,
            rgw_user_uid=rgw_user_uid,
            rgw_tenant=rgw_tenant,
            rgw_account_id=rgw_account_id,
            **destination.persistence_values(),
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(connection)
        self.db.flush()
        refresh_connection_detected_capabilities(connection)
        provisioning.s3_connection_id = connection.id
        provisioning.state = "active"
        provisioning.cleanup_error = None
        provisioning.updated_at = utcnow()
        commit_or_rollback(self.db)
        self.db.refresh(connection)
        result = ManagedPrivateAccessResult(
            provisioning_id=provisioning.id,
            status="active",
            connection=self.connections.serialize(connection),
        )
        self.audit.record(user, provisioning, "managed_private_access.provision.success")
        return result

    def _rgw_identity(
        self,
        provisioning: ManagedPrivateAccess,
    ) -> tuple[str | None, str | None, str | None]:
        user_uid = None
        tenant = None
        account_id = None
        if provisioning.remote_principal_type == "iam_user":
            if provisioning.source_context_type == "account":
                source_account = self.db.get(S3Account, provisioning.source_context_id)
                account_id = (
                    source_account.rgw_account_id if source_account is not None else None
                )
            elif provisioning.source_context_type == "connection":
                source_connection = self.db.get(S3Connection, provisioning.source_context_id)
                account_id = (
                    source_connection.rgw_account_id
                    if source_connection is not None
                    else None
                )
        elif provisioning.remote_principal_type == "rgw_user":
            user_uid, tenant = extract_rgw_user_identity(
                {"uid": provisioning.remote_principal_identifier}
            )
        else:
            raise ManagedPrivateAccessError(
                f"Unsupported remote principal type: {provisioning.remote_principal_type}"
            )
        return normalize_connection_rgw_identity(user_uid, tenant, account_id)
