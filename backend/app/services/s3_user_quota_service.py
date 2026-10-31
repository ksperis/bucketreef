# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.db import S3User
from app.services.rgw_quota_update import (
    execute_rgw_quota_update,
    prepare_rgw_quota_update,
)
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions


class S3UserQuotaService:
    """Apply RGW user quota changes through the managed user's Admin Ops context."""

    def __init__(self, rgw_context: S3UserRgwContextService) -> None:
        self.rgw_context = rgw_context

    def update(
        self,
        s3_user: S3User,
        max_size_gb: Optional[float],
        max_objects: Optional[int],
        max_size_unit: Optional[str] = None,
    ) -> None:
        require_endpoint_permissions(s3_user.storage_endpoint, "users_write")
        admin = self.rgw_context.admin_for_user(s3_user)
        quota = prepare_rgw_quota_update(max_size_gb, max_objects, max_size_unit)

        def update_remote_quota():
            tenant = self.rgw_context.verified_user_tenant(s3_user, admin)
            return admin.set_user_quota(
                uid=s3_user.rgw_user_uid,
                **({"tenant": tenant} if tenant else {}),
                max_size_bytes=quota.max_size_bytes,
                max_objects=quota.max_objects,
                enabled=quota.enabled,
            )

        execute_rgw_quota_update(
            update_remote_quota,
            subject="user",
            identifier=s3_user.rgw_user_uid,
        )
