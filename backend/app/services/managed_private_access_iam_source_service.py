# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""IAM source authorization for managed private access."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import S3Account, S3Connection, User
from app.services.effective_access_service import EffectiveAccessService, ResolvedUserAccess
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
)
from app.services.managed_private_access_sources import ManagedPrivateAccessSource, source_ids
from app.services.managed_resource_naming import managed_private_iam_username
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.s3_connection_capabilities import s3_connection_can_manage_iam
from app.utils.storage_endpoint_features import resolve_feature_flags


class ManagedPrivateAccessIAMSourceService:
    """Authorize account and connection contexts for managed IAM provisioning."""

    def __init__(self, db: Session, access: EffectiveAccessService) -> None:
        self.db = db
        self.access = access

    def resolve(
        self,
        user: User,
        context: S3ExecutionTarget,
    ) -> ManagedPrivateAccessSource:
        effective = self.access.resolve_user(user)
        connection_id, s3_user_id, account_id = source_ids(context)
        if isinstance(connection_id, int):
            return self._resolve_connection(user, effective, connection_id)

        if s3_user_id is not None:
            raise ManagedPrivateAccessForbidden(
                "IAM provisioning is not available for an RGW User context"
            )
        if not isinstance(account_id, int) or account_id <= 0:
            raise ManagedPrivateAccessForbidden(
                "A persisted RGW Account context is required"
            )
        return self._resolve_account(user.id, effective, account_id)

    def _resolve_connection(
        self,
        user: User,
        effective: ResolvedUserAccess,
        connection_id: int,
    ) -> ManagedPrivateAccessSource:
        connection = self.db.scalar(
            select(S3Connection).where(S3Connection.id == connection_id)
        )
        if (
            connection is None
            or not self.access.connection_is_allowed(
                user,
                connection,
                workspace="manager",
                resolved=effective,
            )
            or not s3_connection_can_manage_iam(connection.capabilities)
        ):
            raise ManagedPrivateAccessForbidden(
                "IAM provisioning is not allowed for this connection"
            )
        endpoint = connection.storage_endpoint
        if endpoint is not None and not resolve_feature_flags(endpoint).iam_enabled:
            raise ManagedPrivateAccessForbidden(
                "IAM is disabled for this endpoint"
            )
        username = managed_private_iam_username(user.id, "connection", connection.id)
        return ManagedPrivateAccessSource(
            "connection",
            connection.id,
            "iam_user",
            username,
            username,
        )

    def _resolve_account(
        self,
        user_id: int,
        effective: ResolvedUserAccess,
        account_id: int,
    ) -> ManagedPrivateAccessSource:
        link = effective.account_link_for(account_id)
        if link is None or not self.access.manager_account_allowed(link):
            raise ManagedPrivateAccessForbidden(
                "Account administrator access is required"
            )
        source_account = self.db.scalar(
            select(S3Account).where(S3Account.id == account_id)
        )
        if source_account is None or source_account.storage_endpoint is None:
            raise ManagedPrivateAccessError(
                "The account has no usable storage endpoint"
            )
        if not resolve_feature_flags(source_account.storage_endpoint).iam_enabled:
            raise ManagedPrivateAccessForbidden(
                "IAM is disabled for this endpoint"
            )
        username = managed_private_iam_username(user_id, "account", account_id)
        return ManagedPrivateAccessSource(
            "account",
            account_id,
            "iam_user",
            username,
            username,
        )
