# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import rollback_safely
from app.db import S3User, StorageEndpoint
from app.models.s3_user import S3UserCreate
from app.services.app_settings_service import load_app_settings_for_db
from app.services.feature_policy_service import validate_manager_overrides
from app.services.managed_resource_naming import managed_s3_user_uid
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_user_key_parser import RgwUserKeyParser
from app.services.s3_user_metrics_service import S3UserMetricsService
from app.services.s3_user_quota_service import S3UserQuotaService
from app.services.s3_user_repository import S3UserRepository
from app.services.s3_user_rgw_context_service import S3UserRgwContextService
from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions
from app.services.tags_service import TagsService
from app.utils.rgw_payloads import split_rgw_tenant_uid


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class S3UserProvisioningResult:
    s3_user: S3User
    endpoint: StorageEndpoint
    quota_max_size_gb: float | None
    quota_max_objects: int | None


class S3UserProvisioningService:
    """Create BucketReef-managed RGW users and persist their credentials."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3UserRepository | None = None,
        rgw_context: S3UserRgwContextService | None = None,
        quota: S3UserQuotaService | None = None,
        metrics: S3UserMetricsService | None = None,
        tags: TagsService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3UserRepository(db)
        self.rgw_context = rgw_context or S3UserRgwContextService(db)
        self.quota = quota or S3UserQuotaService(self.rgw_context)
        self.metrics = metrics or S3UserMetricsService()
        self.tags = tags or TagsService(db)

    def create_user(self, payload: S3UserCreate) -> S3UserProvisioningResult:
        app_settings = load_app_settings_for_db(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies)
        uid, tenant = split_rgw_tenant_uid(
            (payload.uid or "").strip() or managed_s3_user_uid(),
            payload.rgw_tenant,
        )
        if tenant and not app_settings.general.allow_managed_rgw_tenant_creation:
            raise ValueError("Managed RGW tenant creation is disabled")

        endpoint = self.rgw_context.resolve_storage_endpoint(payload.storage_endpoint_id)
        require_endpoint_permissions(endpoint, "users_write")
        admin = self.rgw_context.admin_for_endpoint(endpoint)
        if self.repository.find_identity(
            uid=uid,
            tenant=tenant,
            storage_endpoint_id=endpoint.id,
        ):
            raise ValueError("An S3 user with this UID already exists in this tenant")

        remote_created = False
        try:
            response = self._create_remote_user(
                admin,
                payload,
                uid=uid,
                tenant=tenant,
            )
            remote_created = True
            access_key, secret_key = self._resolve_remote_user_credentials(
                admin,
                response,
                uid=uid,
                tenant=tenant,
            )
            s3_user = S3User(
                name=payload.name,
                rgw_user_uid=uid,
                rgw_tenant=tenant,
                email=payload.email,
                rgw_access_key=access_key,
                rgw_secret_key=secret_key,
                storage_endpoint_id=endpoint.id,
            )
            self.db.add(s3_user)
            self.db.flush()
            self.tags.replace_s3_user_tags(s3_user, payload.tags)

            if payload.quota_max_size_gb is not None or payload.quota_max_objects is not None:
                self.quota.update(
                    s3_user,
                    payload.quota_max_size_gb,
                    payload.quota_max_objects,
                    payload.quota_max_size_unit,
                )

            self.db.commit()
        except Exception as exc:
            rollback_error = rollback_safely(self.db)
            if rollback_error is not None:  # pragma: no cover - defensive database failure
                logger.error(
                    "Unable to roll back failed S3 user creation transaction: %s",
                    rollback_error,
                )
            remote_rollback_failed = False
            if remote_created:
                remote_rollback_failed = self._delete_created_remote_user(
                    admin,
                    uid=uid,
                    tenant=tenant,
                )
            if rollback_error is not None or remote_rollback_failed:
                raise RuntimeError(
                    "Unable to create S3 user. Local or RGW rollback also failed."
                ) from exc
            raise

        self.db.refresh(s3_user)
        quota_max_size_gb, quota_max_objects = self.metrics.get_quota(s3_user, admin)
        return S3UserProvisioningResult(
            s3_user=s3_user,
            endpoint=endpoint,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
        )

    @staticmethod
    def _create_remote_user(
        admin: RGWAdminClient,
        payload: S3UserCreate,
        *,
        uid: str,
        tenant: str,
    ) -> dict:
        try:
            response = admin.create_user(
                uid=uid,
                display_name=payload.name,
                email=payload.email or "",
                **({"tenant": tenant} if tenant else {}),
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW user creation failed: {exc}") from exc
        if isinstance(response, dict) and response.get("conflict"):
            raise ValueError("An RGW user with this UID already exists in this tenant")
        return response

    @staticmethod
    def _resolve_remote_user_credentials(
        admin: RGWAdminClient,
        response: dict,
        *,
        uid: str,
        tenant: str,
    ) -> tuple[str, str]:
        access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
            admin.extract_keys(response)
        )
        if not access_key or not secret_key:
            try:
                key_response = admin.create_access_key(uid, tenant=tenant or None)
            except RGWAdminError as exc:
                raise ValueError(f"Unable to obtain RGW access keys: {exc}") from exc
            access_key, secret_key = RgwUserKeyParser.select_complete_credentials(
                admin.extract_keys(key_response)
            )
        if not access_key or not secret_key:
            raise ValueError("RGW did not return access credentials for the new user")
        return access_key, secret_key

    @staticmethod
    def _delete_created_remote_user(
        admin: RGWAdminClient,
        *,
        uid: str,
        tenant: str,
    ) -> bool:
        try:
            admin.delete_user(uid, tenant=tenant or None)
        except Exception as exc:  # pragma: no cover - defensive remote failure
            logger.error(
                "Unable to remove RGW user %s after failed creation: %s",
                uid,
                exc,
            )
            return True
        return False
