# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""Authorization and request policy for managed private-access provisioning."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import User
from app.models.feature_policy import FeaturePolicy
from app.models.managed_private_access import ManagedIAMPrivateAccessRequest
from app.services import app_settings_service
from app.services.effective_access_contracts import ResolvedUserAccess
from app.services.effective_access_service import EffectiveAccessService
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
)
from app.services.managed_private_access_rgw_user_source_service import (
    ManagedPrivateAccessRGWUserSourceService,
)
from app.services.managed_resource_naming import PORTAL_MANAGED_IAM_GROUP_NAMES
from app.services.rgw_iam import RGWIAMService
from app.services.s3_execution_context import S3ExecutionTarget


AMAZON_S3_FULL_ACCESS_POLICY_ARN = "arn:aws:iam::aws:policy/AmazonS3FullAccess"


class ManagedPrivateAccessPolicyService:
    """Evaluate managed private-access availability and IAM request policy."""

    def __init__(
        self,
        db: Session,
        *,
        access: EffectiveAccessService | None = None,
        rgw_user_sources: ManagedPrivateAccessRGWUserSourceService | None = None,
    ) -> None:
        self.db = db
        self.access = access or EffectiveAccessService(db)
        self.rgw_user_sources = rgw_user_sources or ManagedPrivateAccessRGWUserSourceService(
            db,
            self.access,
        )

    def managed_provisioning_allowed(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> bool:
        if (
            app_settings_service.load_app_settings_for_db_readonly(self.db)
            .manager.feature_policies.managed_private_connection_provisioning
            == FeaturePolicy.DISABLED
        ):
            return False
        effective = resolved or self.access.resolve_user(user)
        return effective.can_provision_managed_private_connections

    def ensure_managed_private_connection_provisioning_allowed(
        self,
        user: User,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> None:
        if not self.managed_provisioning_allowed(user, resolved=resolved):
            raise ManagedPrivateAccessForbidden(
                "Managed private S3 connection provisioning is not allowed for this user"
            )

    def rgw_user_provisioning_available(
        self,
        user: User,
        context: S3ExecutionTarget,
        *,
        resolved: ResolvedUserAccess | None = None,
    ) -> bool:
        try:
            self.ensure_managed_private_connection_provisioning_allowed(
                user,
                resolved=resolved,
            )
            self.rgw_user_sources.resolve(user, context)
        except ManagedPrivateAccessError:
            return False
        return True

    def validate_iam_provisioning_request(
        self,
        iam: RGWIAMService,
        payload: ManagedIAMPrivateAccessRequest,
    ) -> None:
        try:
            self._validate_iam_selections(iam, payload)
        except ManagedPrivateAccessError:
            raise
        except Exception as exc:
            raise ManagedPrivateAccessError("Unable to validate IAM groups and policies") from exc

    @staticmethod
    def _validate_iam_selections(
        iam: RGWIAMService,
        payload: ManagedIAMPrivateAccessRequest,
    ) -> None:
        if set(payload.groups) & PORTAL_MANAGED_IAM_GROUP_NAMES:
            raise ManagedPrivateAccessForbidden(
                "Portal-managed IAM groups cannot be assigned to private access identities"
            )
        available_groups = {group.name for group in iam.list_groups()}
        invalid_groups = sorted(set(payload.groups) - available_groups)
        if invalid_groups:
            raise ManagedPrivateAccessError(f"Unknown IAM groups: {', '.join(invalid_groups)}")
        available_policies = {AMAZON_S3_FULL_ACCESS_POLICY_ARN} | {
            policy.arn for policy in iam.list_policies()
        }
        invalid_policies = sorted(set(payload.managed_policies) - available_policies)
        if invalid_policies:
            raise ManagedPrivateAccessError(f"Unknown IAM policies: {', '.join(invalid_policies)}")
        inline_names = [inline.name for inline in payload.inline_policies]
        if len(inline_names) != len(set(inline_names)):
            raise ManagedPrivateAccessError("Inline policy names must be unique")
