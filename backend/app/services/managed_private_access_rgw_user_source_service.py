# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
"""RGW User source authorization for managed private access."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import S3User, StorageProvider, User
from app.models.feature_policy import resolve_feature_policy
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.effective_access_service import EffectiveAccessService
from app.services.managed_private_access_errors import (
    ManagedPrivateAccessError,
    ManagedPrivateAccessForbidden,
)
from app.services.managed_private_access_sources import ManagedPrivateAccessSource, source_ids
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_principal_scope import resolve_target_tenant
from app.services.s3_execution_context import S3ExecutionTarget
from app.utils.rgw_payloads import rgw_qualified_uid
from app.utils.storage_endpoint_features import resolve_feature_flags


class ManagedPrivateAccessRGWUserSourceService:
    """Authorize assigned Ceph RGW User contexts for managed key provisioning."""

    def __init__(self, db: Session, access: EffectiveAccessService) -> None:
        self.db = db
        self.access = access

    def resolve(
        self,
        user: User,
        context: S3ExecutionTarget,
    ) -> ManagedPrivateAccessSource:
        _, s3_user_id, _ = source_ids(context)
        if not isinstance(s3_user_id, int) or s3_user_id <= 0:
            raise ManagedPrivateAccessForbidden(
                "An assigned RGW User context is required"
            )
        s3_user = self._load_assigned(user, s3_user_id)
        self._require_managed_ceph_source(s3_user)
        principal = self._principal(s3_user)
        return ManagedPrivateAccessSource(
            "s3_user",
            s3_user.id,
            "rgw_user",
            principal,
            None,
        )

    def _load_assigned(self, user: User, s3_user_id: int) -> S3User:
        resolved = self.access.resolve_user(user)
        if not resolved.has_s3_user(s3_user_id):
            raise ManagedPrivateAccessForbidden(
                "The RGW User is not assigned to this user"
            )
        s3_user = self.db.scalar(
            select(S3User).where(S3User.id == s3_user_id)
        )
        if s3_user is None:
            raise ManagedPrivateAccessError("RGW User not found")
        return s3_user

    def _require_managed_ceph_source(self, s3_user: S3User) -> None:
        endpoint = s3_user.storage_endpoint
        if (
            not resolve_feature_policy(
                load_app_settings_for_db_readonly(self.db).manager.feature_policies.managed_private_connection_provisioning,
                s3_user.allow_managed_private_connection_provisioning,
            ).enabled
            or endpoint is None
            or endpoint.provider != StorageProvider.CEPH.value
            or not resolve_feature_flags(endpoint).admin_enabled
            or not (endpoint.admin_access_key or "").strip()
            or not (endpoint.admin_secret_key or "").strip()
        ):
            raise ManagedPrivateAccessForbidden(
                "Managed Ceph private access is not allowed for this context"
            )

    @staticmethod
    def _principal(s3_user: S3User) -> str:
        try:
            return rgw_qualified_uid(s3_user.rgw_user_uid, resolve_target_tenant(s3_user))
        except (ValueError, RGWAdminError) as exc:
            raise ManagedPrivateAccessError("The RGW User tenant could not be verified") from exc
