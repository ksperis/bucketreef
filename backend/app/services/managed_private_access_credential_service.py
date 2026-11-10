# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Remote credential provisioning for managed private access."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import ManagedPrivateAccess
from app.models.managed_private_access import ManagedIAMPrivateAccessRequest
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessConflict,
    ManagedPrivateAccessError,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.rgw_iam import RGWIAMService
from app.services.s3_user_key_management_service import S3UserKeyManagementService


class ManagedPrivateAccessCredentialService:
    """Create remote credentials while checkpointing compensatable state."""

    def __init__(
        self,
        db: Session,
        *,
        state: ManagedPrivateAccessStateService | None = None,
    ) -> None:
        self.db = db
        self.state = state or ManagedPrivateAccessStateService(db)

    def provision_iam(
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
        self.state.checkpoint(provisioning, created_remote_principal=True)

        for group_name in payload.groups:
            iam.add_user_to_group(group_name, username)
            self.state.append_list_value(provisioning, "iam_groups", group_name)
        for policy_arn in payload.managed_policies:
            iam.attach_user_policy(username, policy_arn)
            self.state.append_list_value(
                provisioning,
                "iam_managed_policies",
                policy_arn,
            )
        for inline in payload.inline_policies:
            iam.put_user_inline_policy(username, inline.name, inline.document)
            self.state.append_list_value(
                provisioning,
                "iam_inline_policy_names",
                inline.name,
            )

        key = iam.create_access_key(username)
        if not key.access_key_id or not key.secret_access_key:
            raise ManagedPrivateAccessError(
                "RGW IAM did not return complete access credentials"
            )
        self.state.checkpoint(
            provisioning,
            access_key_id=key.access_key_id,
            created_access_key=True,
        )
        return key.access_key_id, key.secret_access_key

    def provision_rgw_user(
        self,
        provisioning: ManagedPrivateAccess,
        *,
        source_id: int,
    ) -> tuple[str, str]:
        key = S3UserKeyManagementService(self.db).create_access_key_entry(source_id)
        self.state.checkpoint(
            provisioning,
            access_key_id=key.access_key_id,
            created_access_key=True,
        )
        return key.access_key_id, key.secret_access_key
