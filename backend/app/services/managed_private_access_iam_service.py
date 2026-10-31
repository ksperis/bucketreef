# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Resolve IAM administration clients for managed private-access workflows."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import ManagedPrivateAccess, S3Account, S3Connection, User
from app.services.effective_access_service import EffectiveAccessService
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
)
from app.services.rgw_iam import (
    RGWIAMService,
    get_iam_service,
    get_iam_service_for_execution_target,
)
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.s3_connection_endpoint import resolve_connection_details
from app.utils.storage_endpoint_features import (
    aws_iam_client_options_for_region,
    resolve_iam_endpoint,
    resolve_iam_signing_region,
)


class ManagedPrivateAccessIAMService:
    """Resolve authorized IAM clients without provisioning side effects."""

    def __init__(
        self,
        db: Session,
        *,
        access: EffectiveAccessService | None = None,
    ) -> None:
        self.db = db
        self.access = access or EffectiveAccessService(db)

    @staticmethod
    def for_context(context: S3ExecutionTarget) -> RGWIAMService:
        service = get_iam_service_for_execution_target(context)
        if service is None:
            raise ManagedPrivateAccessError(
                "The source context has no IAM administration credentials"
            )
        return service

    def for_source(
        self,
        provisioning: ManagedPrivateAccess,
        user: User,
    ) -> RGWIAMService:
        if provisioning.source_context_type == "account":
            link = self.access.resolve_user(user).account_link_for(
                provisioning.source_context_id
            )
            if link is None or not self.access.manager_account_allowed(link):
                raise ManagedPrivateAccessForbidden("Account access was revoked")
            account = self.db.get(S3Account, provisioning.source_context_id)
            if account is None:
                raise ManagedPrivateAccessError("Source account not found")
            return self.for_context(account)

        if provisioning.source_context_type != "connection":
            raise ManagedPrivateAccessError("Invalid IAM source context")
        connection = self.db.get(S3Connection, provisioning.source_context_id)
        if connection is None or not self.access.connection_is_allowed(
            user,
            connection,
            workspace="manager",
        ):
            raise ManagedPrivateAccessForbidden("Source connection access was revoked")

        details = resolve_connection_details(connection)
        endpoint = connection.storage_endpoint
        if endpoint is not None:
            iam_endpoint = resolve_iam_endpoint(endpoint)
            iam_region = resolve_iam_signing_region(endpoint)
        elif (details.provider or "").strip().lower() == "aws":
            iam_endpoint, iam_region = aws_iam_client_options_for_region(details.region)
        else:
            iam_endpoint, iam_region = details.endpoint_url, details.region
        return get_iam_service(
            connection.access_key_id,
            connection.secret_access_key,
            endpoint=iam_endpoint,
            region=iam_region,
            verify_tls=details.verify_tls,
        )
