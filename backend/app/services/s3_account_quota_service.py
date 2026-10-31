# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.db import S3Account
from app.services.rgw_quota_update import (
    execute_rgw_quota_update,
    prepare_rgw_quota_update,
)
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions


class S3AccountQuotaService:
    """Apply RGW account quota changes through the account Admin Ops context."""

    def __init__(self, rgw_context: S3AccountRgwContextService) -> None:
        self.rgw_context = rgw_context

    def update(
        self,
        account: S3Account,
        max_size_gb: Optional[float],
        max_objects: Optional[int],
        max_size_unit: Optional[str] = None,
    ) -> None:
        require_endpoint_permissions(account.storage_endpoint, "accounts_write")
        admin = self.rgw_context.admin_for_account(account)
        if admin is None:
            raise ValueError("RGW administrative credentials are required")
        quota = prepare_rgw_quota_update(max_size_gb, max_objects, max_size_unit)
        execute_rgw_quota_update(
            lambda: admin.set_account_quota(
                account_id=account.rgw_account_id,
                max_size_bytes=quota.max_size_bytes,
                max_objects=quota.max_objects,
                enabled=quota.enabled,
            ),
            subject="account",
            identifier=account.rgw_account_id,
        )
