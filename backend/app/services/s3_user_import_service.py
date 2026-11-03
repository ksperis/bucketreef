# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
import logging

from sqlalchemy.orm import Session

from app.db import S3User, StorageEndpoint
from app.models.s3_user import S3UserImport
from app.services.app_settings_service import load_app_settings_for_db
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.utils.rgw_payloads import require_rgw_user_identity, split_rgw_tenant_uid


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class S3UserImportResult:
    s3_user: S3User
    endpoint: StorageEndpoint
    quota_max_size_gb: float | None
    quota_max_objects: int | None


@dataclass(frozen=True)
class _CreatedImportAccessKey:
    admin: RGWAdminClient
    uid: str
    tenant: str
    access_key_id: str


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
        created_keys: list[_CreatedImportAccessKey] = []
        try:
            for payload, uid, tenant in parsed_items:
                result = self._import_user(
                    payload,
                    uid=uid,
                    tenant=tenant,
                    created_keys=created_keys,
                )
                if result is not None:
                    imported.append(result)
            self.db.commit()
            return imported
        except Exception as exc:
            db_rollback_failed = False
            try:
                self.db.rollback()
            except Exception as rollback_exc:  # pragma: no cover - defensive database failure
                logger.error("Unable to roll back failed S3 user import transaction: %s", rollback_exc)
                db_rollback_failed = True
            cleanup_failures = self._delete_created_import_keys(created_keys)
            if db_rollback_failed or cleanup_failures:
                raise RuntimeError(
                    "Unable to import S3 users. Local or RGW rollback also failed."
                ) from exc
            raise

    def _import_user(
        self,
        payload: S3UserImport,
        *,
        uid: str,
        tenant: str,
        created_keys: list[_CreatedImportAccessKey],
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

        existing_access_keys = RgwUserKeyParser.access_key_ids(
            admin.extract_keys(user_info)
        )
        try:
            key_response = admin.create_access_key(uid, tenant=tenant or None)
        except RGWAdminError as exc:
            raise ValueError(f"Unable to create access key for {uid}: {exc}") from exc
        key_entries = admin.extract_keys(key_response)
        new_access_keys = (
            RgwUserKeyParser.access_key_ids(key_entries) - existing_access_keys
        )
        if len(new_access_keys) != 1:
            try:
                current_user = admin.get_user(
                    uid,
                    tenant=tenant or None,
                    allow_not_found=True,
                )
            except RGWAdminError:
                current_user = None
            if current_user and not current_user.get("not_found"):
                require_rgw_user_identity(current_user, uid, tenant)
                new_access_keys = (
                    RgwUserKeyParser.access_key_ids(admin.extract_keys(current_user))
                    - existing_access_keys
                )
        if len(new_access_keys) != 1:
            raise ValueError(
                f"RGW did not return an unambiguous new access key for {uid}"
            )
        created_access_key = next(iter(new_access_keys))
        created_keys.append(
            _CreatedImportAccessKey(
                admin=admin,
                uid=uid,
                tenant=tenant,
                access_key_id=created_access_key,
            )
        )
        generated = RgwUserKeyParser.to_generated_key(
            key_entries,
            existing_access_keys=existing_access_keys,
        )
        if generated.access_key_id != created_access_key:
            raise ValueError(f"RGW did not return access credentials for {uid}")
        access_key = generated.access_key_id
        secret_key = generated.secret_access_key

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

    @staticmethod
    def _delete_created_import_keys(
        created_keys: list[_CreatedImportAccessKey],
    ) -> list[_CreatedImportAccessKey]:
        failures: list[_CreatedImportAccessKey] = []
        for created in reversed(created_keys):
            try:
                created.admin.delete_access_key(
                    created.uid,
                    created.access_key_id,
                    tenant=created.tenant or None,
                )
            except Exception as exc:  # pragma: no cover - defensive remote failure
                logger.error(
                    "Unable to roll back imported RGW access key %s for user %s: %s",
                    created.access_key_id,
                    created.uid,
                    exc,
                )
                failures.append(created)
        return failures
