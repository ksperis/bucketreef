# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.db import S3User, StorageEndpoint
from app.models.s3_user import S3UserImport
from app.services.app_settings_service import load_app_settings_for_db
from app.services.rgw_admin import RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.utils.rgw_payloads import require_rgw_user_identity, split_rgw_tenant_uid


@dataclass(frozen=True)
class S3UserImportResult:
    s3_user: S3User
    endpoint: StorageEndpoint
    quota_max_size_gb: float | None
    quota_max_objects: int | None


class S3UserImportService:
    """Import existing RGW users into BucketReef-managed S3 user records."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3UserRepository | None = None,
        rgw_context: S3UserRgwContextService | None = None,
        metrics: S3UserMetricsService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3UserRepository(db)
        self.rgw_context = rgw_context or S3UserRgwContextService(db)
        self.metrics = metrics or S3UserMetricsService()

    def import_users(self, items: list[S3UserImport]) -> list[S3UserImportResult]:
        app_settings = load_app_settings_for_db(self.db)
        parsed_items: list[tuple[S3UserImport, str, str]] = []
        for payload in items:
            uid, tenant = split_rgw_tenant_uid(payload.uid, payload.rgw_tenant)
            if not uid:
                raise ValueError("uid is required")
            if tenant and not app_settings.general.allow_managed_rgw_tenant_creation:
                raise ValueError("Managed RGW tenant creation is disabled")
            parsed_items.append((payload, uid, tenant))

        imported: list[S3UserImportResult] = []
        for payload, uid, tenant in parsed_items:
            result = self._import_user(payload, uid=uid, tenant=tenant)
            if result is not None:
                imported.append(result)
        self.db.commit()
        return imported

    def _import_user(
        self,
        payload: S3UserImport,
        *,
        uid: str,
        tenant: str,
    ) -> S3UserImportResult | None:
        endpoint = self.rgw_context.resolve_storage_endpoint(payload.storage_endpoint_id)
        admin = self.rgw_context.admin_for_endpoint(endpoint)
        if self.repository.find_identity(
            uid=uid,
            tenant=tenant,
            storage_endpoint_id=endpoint.id,
        ):
            return None

        try:
            user_info = admin.get_user(uid, tenant=tenant or None, allow_not_found=True)
        except RGWAdminError as exc:
            raise ValueError(f"RGW lookup failed for {uid}: {exc}") from exc
        if not user_info or user_info.get("not_found"):
            raise ValueError(f"RGW user {uid} not found")
        require_rgw_user_identity(user_info, uid, tenant)

        try:
            key_response = admin.create_access_key(uid, tenant=tenant or None)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to create access key for {uid}: {exc}") from exc
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            admin.extract_keys(key_response)
        )
        if not access_key or not secret_key:
            raise ValueError(f"RGW did not return access credentials for {uid}")

        s3_user = S3User(
            name=payload.name or user_info.get("display_name") or uid,
            rgw_user_uid=uid,
            rgw_tenant=tenant,
            email=payload.email or user_info.get("email"),
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(s3_user)
        self.db.flush()
        quota_max_size_gb, quota_max_objects = self.metrics.get_quota(s3_user, admin)
        return S3UserImportResult(
            s3_user=s3_user,
            endpoint=endpoint,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
        )
