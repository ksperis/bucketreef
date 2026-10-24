# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import (
    S3Account,
    S3Connection,
    S3User,
    StorageEndpoint,
    StorageProvider,
    User,
    UserRole,
    UserS3Account,
    UserS3User,
)
from app.services.admin_metrics_service import AdminMetricsService
from app.services.auth_session_service import AuthSessionService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services.traffic_service import TrafficWindow
from app.utils.http_errors import raise_bad_request_from_value_error
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import resolve_feature_flags
from app.utils.usage_stats import build_bucket_overview, summarize_bucket_usage

@dataclass(frozen=True)
class _AssignmentCounts:
    total: int
    assigned: int


class AdminStatsService:
    """Resolve Admin statistics scope and collect endpoint/principal metrics."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def summary(self, actor: User) -> dict:
        payload = self.platform_summary()
        session_counts = AuthSessionService(self.db).counts_by_principal_type_for_admin(actor)
        payload["total_active_sessions"] = sum(session_counts.values())
        payload["active_sessions_by_type"] = {
            "ui": session_counts.get("user", 0),
            "s3": session_counts.get("s3", 0),
        }
        return payload

    def _account_assignment_counts(self) -> _AssignmentCounts:
        total = int(self.db.scalar(select(func.count(S3Account.id))) or 0)
        assigned = int(
            self.db.scalar(
                select(func.count(func.distinct(S3Account.id))).join(
                    UserS3Account,
                    UserS3Account.account_id == S3Account.id,
                )
            )
            or 0
        )
        return _AssignmentCounts(total=total, assigned=assigned)

    def _s3_user_assignment_counts(self) -> _AssignmentCounts:
        total = int(self.db.scalar(select(func.count(S3User.id))) or 0)
        assigned = int(
            self.db.scalar(
                select(func.count(func.distinct(S3User.id))).join(
                    UserS3User,
                    UserS3User.s3_user_id == S3User.id,
                )
            )
            or 0
        )
        return _AssignmentCounts(total=total, assigned=assigned)

    def _ui_user_counts(self) -> tuple[int, int, int]:
        admin_count = self.db.scalar(
            select(func.count(User.id)).where(
                User.role.in_([UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value])
            )
        ) or 0
        manager_count = self.db.scalar(
            select(func.count(User.id)).where(User.role == UserRole.UI_USER.value)
        ) or 0
        none_count = self.db.scalar(
            select(func.count(User.id)).where(User.role == UserRole.UI_NONE.value)
        ) or 0
        return int(admin_count), int(manager_count), int(none_count)

    def _endpoint_counts(self) -> tuple[int, int]:
        ceph_count = self.db.scalar(
            select(func.count(StorageEndpoint.id)).where(
                StorageEndpoint.provider == StorageProvider.CEPH.value
            )
        ) or 0
        other_count = self.db.scalar(
            select(func.count(StorageEndpoint.id)).where(
                StorageEndpoint.provider != StorageProvider.CEPH.value
            )
        ) or 0
        return int(ceph_count), int(other_count)

    def _connection_counts(self) -> tuple[int, int, int]:
        total = self.db.scalar(select(func.count(S3Connection.id))) or 0
        shared = self.db.scalar(
            select(func.count(S3Connection.id)).where(S3Connection.is_shared.is_(True))
        ) or 0
        private = self.db.scalar(
            select(func.count(S3Connection.id)).where(S3Connection.is_shared.is_(False))
        ) or 0
        return int(total), int(shared), int(private)

    def platform_summary(self) -> dict:
        accounts = self._account_assignment_counts()
        s3_users = self._s3_user_assignment_counts()
        total_admins, total_managers, total_none_users = self._ui_user_counts()
        total_ceph_endpoints, total_other_endpoints = self._endpoint_counts()
        total_connections, total_shared_connections, total_private_connections = self._connection_counts()
        return {
            "total_accounts": accounts.total,
            "total_users": total_managers,
            "total_admins": total_admins,
            "total_none_users": total_none_users,
            "total_s3_users": s3_users.total,
            "assigned_accounts": accounts.assigned,
            "assigned_s3_users": s3_users.assigned,
            "total_endpoints": total_ceph_endpoints + total_other_endpoints,
            "total_ceph_endpoints": total_ceph_endpoints,
            "total_other_endpoints": total_other_endpoints,
            "total_connections": total_connections,
            "total_shared_connections": total_shared_connections,
            "total_private_connections": total_private_connections,
        }

    def resolve_endpoint(
        self,
        endpoint_id: int | None,
        *,
        require_storage_metrics: bool = False,
        require_usage_logs: bool = False,
    ) -> StorageEndpoint:
        if endpoint_id is not None:
            endpoint = self.db.get(StorageEndpoint, endpoint_id)
            if endpoint is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Endpoint not found.",
                )
        else:
            endpoint = self.db.scalars(
                select(StorageEndpoint).where(
                    StorageEndpoint.is_default.is_(True),
                    StorageEndpoint.provider == StorageProvider.CEPH.value,
                )
            ).first()
            if endpoint is None:
                endpoint = self.db.scalars(
                    select(StorageEndpoint)
                    .where(StorageEndpoint.provider == StorageProvider.CEPH.value)
                    .order_by(StorageEndpoint.is_default.desc(), StorageEndpoint.id.asc())
                ).first()
        if endpoint is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No Ceph endpoint available.",
            )
        if endpoint.provider != StorageProvider.CEPH.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This endpoint is not a Ceph endpoint.",
            )

        features = resolve_feature_flags(endpoint)
        if require_storage_metrics and not features.metrics_enabled:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Storage metrics are disabled for this endpoint",
            )
        if require_usage_logs and not features.usage_enabled:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Usage logs are disabled for this endpoint",
            )
        return endpoint

    @staticmethod
    def _supervision_client(endpoint: StorageEndpoint) -> RGWAdminClient:
        try:
            return get_supervision_rgw_client(endpoint)
        except ValueError as exc:
            raise_bad_request_from_value_error(exc)

    @staticmethod
    def _principal_bucket_stats(rgw_admin: RGWAdminClient, uid: str, tenant: str | None = None) -> dict:
        try:
            payload = rgw_admin.get_all_buckets(
                uid=uid,
                with_stats=True,
                **({"tenant": tenant} if tenant else {}),
            )
        except RGWAdminError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Unable to fetch buckets: {sanitized_error_log_detail(exc)}",
            ) from exc

        bucket_usage, total_bytes, total_objects, total_buckets = summarize_bucket_usage(
            extract_bucket_list(payload)
        )
        return {
            "total_buckets": total_buckets,
            "total_bytes": total_bytes or 0,
            "total_objects": total_objects or 0,
            "bucket_usage": bucket_usage,
            "bucket_overview": build_bucket_overview(bucket_usage),
        }

    def account(self, account_id: int) -> dict:
        account = self.db.get(S3Account, account_id)
        if account is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="S3Account not found",
            )
        endpoint = self.resolve_endpoint(
            account.storage_endpoint_id,
            require_storage_metrics=True,
        )
        return self._principal_bucket_stats(
            self._supervision_client(endpoint),
            account.rgw_user_uid,
            account.rgw_tenant,
        )

    def s3_user(self, user_id: int) -> dict:
        s3_user = self.db.get(S3User, user_id)
        if s3_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="S3 user not found",
            )
        endpoint = self.resolve_endpoint(
            s3_user.storage_endpoint_id,
            require_storage_metrics=True,
        )
        return self._principal_bucket_stats(
            self._supervision_client(endpoint),
            s3_user.rgw_user_uid,
            s3_user.rgw_tenant,
        )

    def storage(self, endpoint_id: int | None) -> dict:
        endpoint = self.resolve_endpoint(endpoint_id, require_storage_metrics=True)
        return AdminMetricsService(
            db=self.db,
            rgw_admin=self._supervision_client(endpoint),
            endpoint_id=endpoint.id,
        ).storage()

    def traffic(self, endpoint_id: int | None, *, window: TrafficWindow) -> dict:
        endpoint = self.resolve_endpoint(endpoint_id, require_usage_logs=True)
        return AdminMetricsService(
            db=self.db,
            rgw_admin=self._supervision_client(endpoint),
            endpoint_id=endpoint.id,
        ).traffic(window=window)
