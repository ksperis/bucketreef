# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from typing import Optional

from app.models.base import ApiModel


class AdminActiveSessionsByType(ApiModel):
    ui: int
    s3: int


class AdminSummary(ApiModel):
    total_accounts: int
    total_users: int
    total_admins: int
    total_none_users: int
    total_active_sessions: int
    active_sessions_by_type: AdminActiveSessionsByType
    total_s3_users: int
    assigned_accounts: int
    assigned_s3_users: int
    total_endpoints: int
    total_ceph_endpoints: int
    total_other_endpoints: int
    total_connections: int
    total_shared_connections: int
    total_private_connections: int


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


class AdminStorageStats(ApiModel):
    total_accounts: int
    total_s3_users: int
    account_usage: list[AdminStorageAccountUsagePoint]
    s3_user_usage: list[AdminStorageS3UserUsagePoint]
    storage_totals: AdminStorageTotals
    generated_at: str
