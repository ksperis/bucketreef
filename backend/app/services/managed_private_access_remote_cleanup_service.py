# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Remote resource cleanup for managed private access."""

from __future__ import annotations

from typing import Callable

from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import ManagedPrivateAccess, User
from app.services.managed_private_access_errors import ManagedPrivateAccessError
from app.services.managed_private_access_iam_service import (
    ManagedPrivateAccessIAMService,
)
from app.services.managed_private_access_state_service import (
    ManagedPrivateAccessStateService,
)
from app.services.rgw_iam import RGWIAMService
from app.services.s3_user_key_management_service import S3UserKeyManagementService


class ManagedPrivateAccessRemoteCleanupService:
    """Delete remote IAM and RGW resources with durable checkpoints."""

    def __init__(
        self,
        db: Session,
        *,
        iam: ManagedPrivateAccessIAMService | None = None,
        state: ManagedPrivateAccessStateService | None = None,
    ) -> None:
        self.db = db
        self.iam = iam or ManagedPrivateAccessIAMService(db)
        self.state = state or ManagedPrivateAccessStateService(db)

    def cleanup(
        self,
        provisioning: ManagedPrivateAccess,
        *,
        user: User,
        use_persisted_source: bool = False,
    ) -> None:
        if provisioning.remote_principal_type == "iam_user":
            if not any(
                (
                    provisioning.created_access_key and provisioning.access_key_id,
                    provisioning.iam_inline_policy_names,
                    provisioning.iam_managed_policies,
                    provisioning.iam_groups,
                    provisioning.created_remote_principal,
                )
            ):
                return
            iam = (
                self.iam.for_cleanup_source(provisioning)
                if use_persisted_source
                else self.iam.for_source(provisioning, user)
            )
            self.cleanup_iam_resources(provisioning, iam)
            return

        self.cleanup_rgw_user_resources(provisioning)

    def cleanup_rgw_user_resources(self, provisioning: ManagedPrivateAccess) -> None:
        if provisioning.created_access_key and provisioning.access_key_id:
            S3UserKeyManagementService(self.db).delete_key(
                provisioning.source_context_id,
                provisioning.access_key_id,
            )
            self.state.checkpoint(provisioning, created_access_key=False)

    def cleanup_iam_resources(
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
            except Exception as exc:
                errors.append(sanitized_error_log_detail(exc))

        if provisioning.created_access_key and provisioning.access_key_id:
            attempt(
                lambda: iam.delete_access_key(username, provisioning.access_key_id or ""),
                lambda: self.state.checkpoint(provisioning, created_access_key=False),
            )
        for name in reversed(provisioning.iam_inline_policy_names):
            attempt(
                lambda name=name: iam.delete_user_inline_policy(username, name),
                lambda name=name: self.state.remove_list_value(
                    provisioning,
                    "iam_inline_policy_names",
                    name,
                ),
            )
        for arn in reversed(provisioning.iam_managed_policies):
            attempt(
                lambda arn=arn: iam.detach_user_policy(username, arn),
                lambda arn=arn: self.state.remove_list_value(
                    provisioning,
                    "iam_managed_policies",
                    arn,
                ),
            )
        for group in reversed(provisioning.iam_groups):
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
                lambda: self.state.checkpoint(provisioning, created_remote_principal=False),
            )
        if errors:
            raise ManagedPrivateAccessError("; ".join(errors))
