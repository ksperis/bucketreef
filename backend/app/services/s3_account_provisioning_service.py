# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
import logging
from typing import Any

from sqlalchemy.orm import Session

from app.db import S3Account, StorageEndpoint
from app.models.s3_account import S3AccountCreate
from app.services.app_settings_service import load_app_settings_for_db
from app.services.feature_policy_service import validate_manager_overrides
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.s3_account_quota_service import S3AccountQuotaService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.storage_endpoint_admin_permissions import require_endpoint_permissions
from app.services.tags_service import TagsService
from app.utils.rgw_identifiers import generate_rgw_account_id
from app.utils.rgw_payloads import (
    extract_rgw_account_ids,
    extract_rgw_account_name,
    extract_rgw_account_tenant,
)


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class S3AccountProvisioningResult:
    account: S3Account
    endpoint: StorageEndpoint
    admin: RGWAdminClient
    quota_max_size_gb: float | None
    quota_max_objects: int | None


class S3AccountProvisioningService:
    """Create or resume BucketReef-managed RGW accounts."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3AccountRepository | None = None,
        rgw_context: S3AccountRgwContextService | None = None,
        account_roots: RgwAccountRootService | None = None,
        quota: S3AccountQuotaService | None = None,
        metrics: S3AccountMetricsService | None = None,
        tags: TagsService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3AccountRepository(db)
        self.rgw_context = rgw_context or S3AccountRgwContextService(db)
        self.account_roots = account_roots or RgwAccountRootService()
        self.quota = quota or S3AccountQuotaService(self.rgw_context)
        self.metrics = metrics or S3AccountMetricsService()
        self.tags = tags or TagsService(db)

    @staticmethod
    def _ensure_account_creation_succeeded(result: Any, expected_id: str) -> None:
        if isinstance(result, dict) and result.get("conflict"):
            raise ValueError(
                "RGW account creation failed: another account already uses "
                "this name or email."
            )
        if not isinstance(result, dict):
            raise ValueError("RGW did not confirm the created account identity")
        returned_ids = extract_rgw_account_ids(result)
        if returned_ids != {expected_id}:
            raise ValueError("RGW did not confirm the requested account identity")

    def _generate_account_id(self) -> str:
        prefix = load_app_settings_for_db(self.db).general.rgw_account_id_prefix
        return generate_rgw_account_id(prefix)

    def ensure_provisioned_account(
        self,
        payload: S3AccountCreate,
        rgw_account_id: str,
    ) -> S3Account:
        """Resume provisioning with an orchestrator-owned durable RGW account ID."""
        self._validate_managed_account_creation_policy(payload)
        existing = self.repository.find_by_rgw_id(rgw_account_id)
        if existing is not None:
            self._validate_existing_scope(existing, payload)
            return existing

        try:
            endpoint, admin = self._prepare_managed_account_creation(payload)
            remote = admin.get_account(rgw_account_id, allow_not_found=True)
            resume = bool(remote and not remote.get("not_found"))
            if not remote or remote.get("not_found"):
                self._create_remote_account(admin, payload, rgw_account_id)
            else:
                self._validate_remote_account(remote, payload, rgw_account_id)

            root_uid, access_key, secret_key = self.account_roots.ensure_provisioned_credentials(
                admin,
                rgw_account_id=rgw_account_id,
                account_name=payload.name,
                resume=resume,
                tenant=payload.rgw_tenant,
            )
            account = self._persist_provisioned_account(
                payload,
                endpoint,
                rgw_account_id=rgw_account_id,
                root_uid=root_uid,
                access_key=access_key,
                secret_key=secret_key,
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(account)
        return account

    def create_account_with_manager(
        self,
        payload: S3AccountCreate,
    ) -> S3AccountProvisioningResult:
        self._validate_managed_account_creation_policy(payload)
        endpoint, admin = self._prepare_managed_account_creation(payload)
        rgw_account_id = self._generate_account_id()
        self._create_remote_account(admin, payload, rgw_account_id)
        try:
            root_uid, access_key, secret_key = self.account_roots.ensure_provisioned_credentials(
                admin,
                rgw_account_id=rgw_account_id,
                account_name=payload.name,
                resume=False,
                tenant=payload.rgw_tenant,
            )
            account = self._persist_provisioned_account(
                payload,
                endpoint,
                rgw_account_id=rgw_account_id,
                root_uid=root_uid,
                access_key=access_key,
                secret_key=secret_key,
            )
            quota_max_size_gb, quota_max_objects = self.metrics.get_quota(account, admin)
            self.db.commit()
        except Exception as exc:
            db_rollback_failed = False
            try:
                self.db.rollback()
            except Exception as rollback_exc:  # pragma: no cover - defensive database failure
                logger.error(
                    "Unable to roll back failed S3 account creation transaction: %s",
                    rollback_exc,
                )
                db_rollback_failed = True
            remote_rollback_failed = self._rollback_created_remote_account(
                admin,
                rgw_account_id=rgw_account_id,
                tenant=payload.rgw_tenant,
            )
            if db_rollback_failed or remote_rollback_failed:
                raise RuntimeError(
                    "Unable to create S3 account. Local or RGW rollback also failed."
                ) from exc
            raise
        self.db.refresh(account)
        return S3AccountProvisioningResult(
            account=account,
            endpoint=endpoint,
            admin=admin,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
        )

    def _rollback_created_remote_account(
        self,
        admin: RGWAdminClient,
        *,
        rgw_account_id: str,
        tenant: str,
    ) -> bool:
        failed = False
        root_uid = self.account_roots.root_uid(rgw_account_id)
        try:
            admin.delete_user(root_uid, tenant=tenant or None)
        except Exception as exc:  # pragma: no cover - defensive remote failure
            logger.error(
                "Unable to remove RGW root %s while rolling back account %s: %s",
                root_uid,
                rgw_account_id,
                exc,
            )
            failed = True
        try:
            admin.delete_account(rgw_account_id)
        except Exception as exc:  # pragma: no cover - defensive remote failure
            logger.error(
                "Unable to remove RGW account %s after failed creation: %s",
                rgw_account_id,
                exc,
            )
            failed = True
        return failed

    def _validate_managed_account_creation_policy(self, payload: S3AccountCreate) -> None:
        app_settings = load_app_settings_for_db(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies)
        if payload.rgw_tenant and not app_settings.general.allow_managed_rgw_tenant_creation:
            raise ValueError("Managed RGW tenant creation is disabled")

    @staticmethod
    def _validate_existing_scope(existing: S3Account, payload: S3AccountCreate) -> None:
        if (
            existing.storage_endpoint_id != payload.storage_endpoint_id
            or existing.name != payload.name
            or existing.rgw_tenant != payload.rgw_tenant
        ):
            raise ValueError("Provisioned account scope changed")

    def _prepare_managed_account_creation(
        self,
        payload: S3AccountCreate,
    ) -> tuple[StorageEndpoint, RGWAdminClient]:
        self.repository.ensure_name_available(
            storage_endpoint_id=payload.storage_endpoint_id,
            rgw_tenant=payload.rgw_tenant,
            name=payload.name,
        )
        endpoint = self.rgw_context.resolve_storage_endpoint(
            payload.storage_endpoint_id,
            require_ceph=True,
        )
        if not self.rgw_context.endpoint_capabilities(endpoint).get("account", False):
            raise ValueError(
                "Selected endpoint does not support RGW account API (/admin/account)."
            )
        admin = self.rgw_context.admin_for_endpoint(endpoint, allow_missing=False)
        if admin is None:
            raise ValueError("RGW administrative credentials are required")
        require_endpoint_permissions(
            endpoint,
            "users_write",
            "accounts_write",
            client=admin,
        )
        return endpoint, admin

    def _create_remote_account(
        self,
        admin: RGWAdminClient,
        payload: S3AccountCreate,
        rgw_account_id: str,
    ) -> None:
        try:
            create_result = admin.create_account(
                account_id=rgw_account_id,
                account_name=payload.name,
                tenant=payload.rgw_tenant or None,
            )
        except RGWAdminError as exc:
            raise ValueError(f"RGW account creation failed: {exc}") from exc
        self._ensure_account_creation_succeeded(create_result, rgw_account_id)
        logger.debug("Created RGW account %s (%s)", rgw_account_id, payload.name)

    @staticmethod
    def _validate_remote_account(
        remote: dict[str, Any],
        payload: S3AccountCreate,
        rgw_account_id: str,
    ) -> None:
        remote_ids = extract_rgw_account_ids(remote)
        remote_name = extract_rgw_account_name(remote)
        if (
            remote_name != payload.name
            or remote_ids != {rgw_account_id}
            or extract_rgw_account_tenant(remote) != payload.rgw_tenant
        ):
            raise ValueError(
                "Provisioned RGW account does not match the requested identity"
            )

    def _persist_provisioned_account(
        self,
        payload: S3AccountCreate,
        endpoint: StorageEndpoint,
        *,
        rgw_account_id: str,
        root_uid: str,
        access_key: str,
        secret_key: str,
    ) -> S3Account:
        account = S3Account(
            name=payload.name,
            rgw_account_id=rgw_account_id,
            rgw_tenant=payload.rgw_tenant,
            rgw_access_key=access_key,
            rgw_secret_key=secret_key,
            rgw_user_uid=root_uid,
            email=payload.email,
            storage_endpoint_id=endpoint.id,
        )
        self.db.add(account)
        self.db.flush()
        self.tags.replace_account_tags(account, payload.tags)
        if payload.quota_max_size_gb is not None or payload.quota_max_objects is not None:
            self.quota.update(
                account,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )
        return account
