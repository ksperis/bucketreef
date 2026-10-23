# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
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
from app.services.bucket_usage_stats_service import (
    BucketUsageStatsAggregateTarget,
    BucketUsageStatsResolvedTarget,
)
from app.services.buckets_service import BucketsService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_supervision import get_supervision_rgw_client
from app.services.traffic_service import TrafficWindow
from app.utils.rgw_payloads import extract_bucket_list
from app.utils.storage_endpoint_features import normalize_features_config
from app.utils.usage_stats import build_bucket_overview, summarize_bucket_usage


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _AssignmentCounts:
    total: int
    assigned: int

    @property
    def unassigned(self) -> int:
        return max(self.total - self.assigned, 0)


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

    @staticmethod
    def _endpoint_scoped_count(db: Session, statement, endpoint_column, endpoint_id: int | None) -> int:
        if endpoint_id is not None:
            statement = statement.where(endpoint_column == endpoint_id)
        return int(db.scalar(statement) or 0)

    @classmethod
    def _account_assignment_counts(
        cls,
        db: Session,
        endpoint_id: int | None,
    ) -> _AssignmentCounts:
        total = cls._endpoint_scoped_count(
            db,
            select(func.count(S3Account.id)),
            S3Account.storage_endpoint_id,
            endpoint_id,
        )
        assigned = cls._endpoint_scoped_count(
            db,
            select(func.count(func.distinct(S3Account.id))).join(
                UserS3Account,
                UserS3Account.account_id == S3Account.id,
            ),
            S3Account.storage_endpoint_id,
            endpoint_id,
        )
        return _AssignmentCounts(total=total, assigned=assigned)

    @classmethod
    def _s3_user_assignment_counts(
        cls,
        db: Session,
        endpoint_id: int | None,
    ) -> _AssignmentCounts:
        total = cls._endpoint_scoped_count(
            db,
            select(func.count(S3User.id)),
            S3User.storage_endpoint_id,
            endpoint_id,
        )
        assigned = cls._endpoint_scoped_count(
            db,
            select(func.count(func.distinct(S3User.id))).join(
                UserS3User,
                UserS3User.s3_user_id == S3User.id,
            ),
            S3User.storage_endpoint_id,
            endpoint_id,
        )
        return _AssignmentCounts(total=total, assigned=assigned)

    @staticmethod
    def _ui_user_counts(db: Session) -> tuple[int, int, int]:
        admin_count = db.scalar(
            select(func.count(User.id)).where(
                User.role.in_([UserRole.UI_ADMIN.value, UserRole.UI_SUPERADMIN.value])
            )
        ) or 0
        manager_count = db.scalar(
            select(func.count(User.id)).where(User.role == UserRole.UI_USER.value)
        ) or 0
        none_count = db.scalar(
            select(func.count(User.id)).where(User.role == UserRole.UI_NONE.value)
        ) or 0
        return int(admin_count), int(manager_count), int(none_count)

    @staticmethod
    def _endpoint_counts(db: Session) -> tuple[int, int]:
        ceph_count = db.scalar(
            select(func.count(StorageEndpoint.id)).where(
                StorageEndpoint.provider == StorageProvider.CEPH.value
            )
        ) or 0
        other_count = db.scalar(
            select(func.count(StorageEndpoint.id)).where(
                StorageEndpoint.provider != StorageProvider.CEPH.value
            )
        ) or 0
        return int(ceph_count), int(other_count)

    @staticmethod
    def _connection_counts(db: Session) -> tuple[int, int, int]:
        total = db.scalar(select(func.count(S3Connection.id))) or 0
        shared = db.scalar(
            select(func.count(S3Connection.id)).where(S3Connection.is_shared.is_(True))
        ) or 0
        private = db.scalar(
            select(func.count(S3Connection.id)).where(S3Connection.is_shared.is_(False))
        ) or 0
        return int(total), int(shared), int(private)

    def platform_summary(self, endpoint_id: int | None = None) -> dict:
        accounts = self._account_assignment_counts(self.db, endpoint_id)
        s3_users = self._s3_user_assignment_counts(self.db, endpoint_id)
        total_admins, total_managers, total_none_users = self._ui_user_counts(self.db)
        total_ceph_endpoints, total_other_endpoints = self._endpoint_counts(self.db)
        total_connections, total_shared_connections, total_private_connections = self._connection_counts(
            self.db
        )
        return {
            "total_accounts": accounts.total,
            "total_users": total_managers,
            "total_admins": total_admins,
            "total_none_users": total_none_users,
            "total_s3_users": s3_users.total,
            "assigned_accounts": accounts.assigned,
            "unassigned_accounts": accounts.unassigned,
            "assigned_s3_users": s3_users.assigned,
            "unassigned_s3_users": s3_users.unassigned,
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

        features = normalize_features_config(endpoint.provider, endpoint.features_config)
        if require_storage_metrics and not features["metrics"]["enabled"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Storage metrics are disabled for this endpoint",
            )
        if require_usage_logs and not features["usage"]["enabled"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Usage logs are disabled for this endpoint",
            )

        supervision = endpoint.service_identity("supervision")
        if (
            supervision is None
            or supervision.status != "ready"
            or not supervision.access_key
            or not supervision.secret_key
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Supervision credentials are not configured for this endpoint.",
            )
        return endpoint

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
            get_supervision_rgw_client(endpoint),
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
            get_supervision_rgw_client(endpoint),
            s3_user.rgw_user_uid,
            s3_user.rgw_tenant,
        )

    def storage(self, endpoint_id: int | None) -> dict:
        endpoint = self.resolve_endpoint(endpoint_id, require_storage_metrics=True)
        return AdminMetricsService(
            db=self.db,
            rgw_admin=get_supervision_rgw_client(endpoint),
            endpoint_id=endpoint.id,
        ).storage()

    def traffic(self, endpoint_id: int | None, *, window: TrafficWindow) -> dict:
        endpoint = self.resolve_endpoint(endpoint_id, require_usage_logs=True)
        return AdminMetricsService(
            db=self.db,
            rgw_admin=get_supervision_rgw_client(endpoint),
            endpoint_id=endpoint.id,
        ).traffic(window=window)


@dataclass(frozen=True)
class AdminManagedUsageScope:
    resolved_targets: list[BucketUsageStatsResolvedTarget]
    aggregate_targets: list[BucketUsageStatsAggregateTarget]
    warnings: list[str]
    managed_account_count: int
    accounts_with_listed_buckets: int
    skipped_account_count: int


class AdminUsageStatsScopeService:
    """Build the managed-account scope used by Admin bucket usage statistics."""

    def __init__(self, db: Session, bucket_service: BucketsService) -> None:
        self.db = db
        self.bucket_service = bucket_service

    def resolve_ceph_endpoint(self, endpoint_id: int) -> StorageEndpoint:
        endpoint = self.db.get(StorageEndpoint, endpoint_id)
        if endpoint is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Endpoint not found.",
            )
        if endpoint.provider != StorageProvider.CEPH.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This endpoint is not a Ceph endpoint.",
            )
        return endpoint

    @staticmethod
    def _manager_scope_id(account: S3Account) -> str:
        account_id = account.id
        if not isinstance(account_id, int) or account_id <= 0:
            raise ValueError("Managed S3 account is missing a local identifier.")
        return str(account_id)

    @staticmethod
    def _account_label(account: S3Account) -> str:
        return account.name or account.rgw_account_id or f"Account {account.id}"

    def _list_account_bucket_names(self, account: S3Account) -> list[str]:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise RuntimeError("S3 account credentials are missing.")
        buckets = self.bucket_service.list_buckets(
            account,
            include=set(),
            with_stats=False,
        )
        return [bucket.name for bucket in buckets if bucket.name]

    def build_scope(self, endpoint: StorageEndpoint) -> AdminManagedUsageScope:
        accounts = self.db.scalars(
            select(S3Account)
            .where(S3Account.storage_endpoint_id == endpoint.id)
            .order_by(S3Account.name.asc(), S3Account.id.asc())
        ).all()
        resolved_targets: list[BucketUsageStatsResolvedTarget] = []
        aggregate_targets: list[BucketUsageStatsAggregateTarget] = []
        warnings: list[str] = []
        skipped_account_count = 0
        accounts_with_listed_buckets = 0

        if not accounts:
            warnings.append("No managed S3 accounts are linked to this endpoint.")

        for account in accounts:
            try:
                bucket_names = self._list_account_bucket_names(account)
            except Exception as exc:  # noqa: BLE001
                skipped_account_count += 1
                logger.warning(
                    "Unable to list managed account buckets for usage stats account=%s: %s",
                    account.id,
                    exc,
                )
                if skipped_account_count <= 3:
                    warnings.append(
                        f"{self._account_label(account)} skipped: bucket listing failed."
                    )
                continue

            accounts_with_listed_buckets += 1
            context_id = self._manager_scope_id(account)
            for bucket_name in bucket_names:
                resolved_targets.append(
                    BucketUsageStatsResolvedTarget(
                        context=account,
                        bucket_name=bucket_name,
                        scope_kind="manager",
                        scope_id=context_id,
                        scope_name=account.name,
                        context_id=context_id,
                        context_name=account.name,
                    )
                )
                aggregate_targets.append(
                    BucketUsageStatsAggregateTarget(
                        scope_kind="manager",
                        scope_id=context_id,
                        bucket_name=bucket_name,
                    )
                )

        if skipped_account_count > 0:
            warnings.insert(
                0,
                f"{skipped_account_count} managed account(s) could not be scanned for bucket usage stats.",
            )

        return AdminManagedUsageScope(
            resolved_targets=resolved_targets,
            aggregate_targets=aggregate_targets,
            warnings=warnings,
            managed_account_count=len(accounts),
            accounts_with_listed_buckets=accounts_with_listed_buckets,
            skipped_account_count=skipped_account_count,
        )
