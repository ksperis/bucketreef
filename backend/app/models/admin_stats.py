# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.models.base import ApiModel


class AdminStorageAccountUsagePoint(ApiModel):
    account_id: str
    account_name: Optional[str]
    used_bytes: Optional[int]
    object_count: Optional[int]
    bucket_count: Optional[int]


class AdminStorageS3UserUsagePoint(ApiModel):
    user_id: int
    user_name: Optional[str]
    rgw_user_uid: str
    used_bytes: Optional[int]
    object_count: Optional[int]
    bucket_count: Optional[int]


class AdminStorageTotals(ApiModel):
    used_bytes: Optional[int]
    object_count: Optional[int]
    bucket_count: Optional[int]
    accounts_with_usage: int


class AdminStorageStats(ApiModel):
    total_accounts: int
    total_s3_users: int
    account_usage: list[AdminStorageAccountUsagePoint]
    s3_user_usage: list[AdminStorageS3UserUsagePoint]
    storage_totals: AdminStorageTotals
    generated_at: str
