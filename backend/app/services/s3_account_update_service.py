# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from app.core.db_transactions import rollback_safely
from app.core.domain_errors import CompensationFailureError
from app.db import S3Account
from app.core.domain_enums import StorageProvider
from app.models.s3_account import S3Account as S3AccountSchema, S3AccountUpdate
from app.services.app_settings_service import load_app_settings_for_db
from app.services.feature_policy_service import (
    apply_resource_feature_overrides,
    validate_subject_feature_overrides,
)
from app.services.mappers.s3_account import s3_account_from_db
from app.services.portal_role_sync import (
    acquire_portal_role_write_transaction,
    capture_effective_portal_roles,
    commit_portal_role_changes,
)
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.s3_account_limits_service import S3AccountLimitsService, S3AccountLimitsSnapshot
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_quota_service import S3AccountQuotaService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.s3_execution_context import S3ExecutionContext
from app.services.tags_service import TagsService
from app.utils.storage_endpoint_features import resolve_feature_flags


logger = logging.getLogger(__name__)


class S3AccountUpdateService:
    """Apply account metadata, quota, association, and Portal-role updates."""

    def __init__(
        self,
        db: Session,
        *,
        repository: S3AccountRepository | None = None,
        rgw_context: S3AccountRgwContextService | None = None,
        quota: S3AccountQuotaService | None = None,
        metrics: S3AccountMetricsService | None = None,
        associations: S3AccountAssociationsService | None = None,
        tags: TagsService | None = None,
        limits: S3AccountLimitsService | None = None,
    ) -> None:
        self.db = db
        self.repository = repository or S3AccountRepository(db)
        self.rgw_context = rgw_context or S3AccountRgwContextService(db)
        self.quota = quota or S3AccountQuotaService(self.rgw_context)
        self.metrics = metrics or S3AccountMetricsService()
        self.associations = associations or S3AccountAssociationsService(db)
        self.tags = tags or TagsService(db)
        self.limits = limits or S3AccountLimitsService(self.rgw_context)

    def update_account(
        self,
        account_id: int,
        payload: S3AccountUpdate,
    ) -> S3AccountSchema:
        account = self.repository.get(account_id)
        self.repository.ensure_not_pending_deletion(account_id)
        limits_requested = self.limits.requested(payload)
        limits_before = self.limits.capture(account) if limits_requested else None
        limits_update_attempted = False

        try:
            if limits_before is not None:
                limits_update_attempted = True
                self.limits.update(limits_before, payload)
            persisted_account = self._persist_update(account, payload)
        except Exception as exc:
            self._rollback_failed_update(
                exc,
                limits_before=limits_before,
                limits_update_attempted=limits_update_attempted,
            )
            raise
        return self._serialize_updated_account(persisted_account)

    def _persist_update(
        self,
        account: S3Account,
        payload: S3AccountUpdate,
    ) -> S3Account:
        affected_portal_user_ids = self.associations.affected_portal_user_ids(
            account,
            payload,
        )
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )
        acquire_portal_role_write_transaction(self.db)

        self._apply_fields(account, payload)
        self._apply_quota(account, payload)
        self._apply_associations(account, payload)
        self.db.flush()
        commit_portal_role_changes(
            self.db,
            before=portal_roles_before,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )
        self.db.refresh(account)
        return account

    def _rollback_failed_update(
        self,
        exc: Exception,
        *,
        limits_before: S3AccountLimitsSnapshot | None,
        limits_update_attempted: bool,
    ) -> None:
        rollback_error = rollback_safely(self.db)
        if rollback_error is not None:  # pragma: no cover - defensive database failure
            logger.error("Unable to roll back failed S3 account update: %s", rollback_error)

        limits_rollback_failed = False
        if limits_update_attempted and limits_before is not None:
            try:
                self.limits.restore(limits_before)
            except Exception as rollback_exc:  # pragma: no cover - defensive remote failure
                logger.error(
                    "Unable to restore RGW limits after failed S3 account update for %s: %s",
                    limits_before.account_id,
                    rollback_exc,
                )
                limits_rollback_failed = True

        if rollback_error is not None or limits_rollback_failed:
            raise CompensationFailureError(
                "Unable to update S3 account. Local or RGW rollback also failed."
            ) from exc

    def _apply_fields(self, account: S3Account, payload: S3AccountUpdate) -> None:
        app_settings = load_app_settings_for_db(self.db)
        validate_subject_feature_overrides(payload, app_settings, account)
        target_endpoint_id = account.storage_endpoint_id
        if payload.storage_endpoint_id is not None:
            endpoint = self.rgw_context.resolve_storage_endpoint(
                payload.storage_endpoint_id,
                require_ceph=True,
            )
            target_endpoint_id = endpoint.id
        target_name = payload.name if payload.name else account.name
        if target_name != account.name or target_endpoint_id != account.storage_endpoint_id:
            self.repository.ensure_name_available(
                storage_endpoint_id=target_endpoint_id,
                rgw_tenant=account.rgw_tenant,
                name=target_name,
                exclude_account_id=account.id,
            )
        if payload.name:
            account.name = payload.name
        if "email" in payload.model_fields_set:
            account.email = payload.email
        if payload.storage_endpoint_id is not None:
            account.storage_endpoint_id = target_endpoint_id
        if payload.tags is not None:
            self.tags.replace_account_tags(account, payload.tags)
        apply_resource_feature_overrides(payload, account)

    def _apply_quota(self, account: S3Account, payload: S3AccountUpdate) -> None:
        if not {"quota_max_size_gb", "quota_max_objects"} & payload.model_fields_set:
            return
        quota_requested = (
            payload.quota_max_size_gb is not None
            or payload.quota_max_objects is not None
        )
        if quota_requested:
            self.quota.update(
                account,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )
            return

        endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        if (
            endpoint.provider == StorageProvider.CEPH.value
            and resolve_feature_flags(endpoint).admin_enabled
        ):
            self.quota.update(
                account,
                payload.quota_max_size_gb,
                payload.quota_max_objects,
                payload.quota_max_size_unit,
            )

    def _apply_associations(self, account: S3Account, payload: S3AccountUpdate) -> None:
        if payload.user_links is not None:
            self.associations.set_user_links(account, payload.user_links)
        if payload.group_links is not None:
            self.associations.set_group_links(account, payload.group_links)

    def _serialize_updated_account(self, account: S3Account) -> S3AccountSchema:
        user_links = self.associations.load_user_links([account.id]).get(
            account.id,
            [],
        )
        group_links = self.associations.load_group_links([account.id]).get(
            account.id,
            [],
        )
        endpoint = self.rgw_context.resolve_storage_endpoint(account.storage_endpoint_id)
        admin = self.rgw_context.admin_for_account(account, allow_missing=True)
        quota_max_size_gb, quota_max_objects = self.metrics.get_quota(
            S3ExecutionContext.from_account(account),
            admin,
        )
        max_buckets = max_users = max_roles = max_groups = None
        if admin is not None:
            _, _, max_buckets, max_users, max_roles, max_groups = self.metrics.get_limits(
                S3ExecutionContext.from_account(account),
                admin,
            )

        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            max_buckets=max_buckets,
            max_users=max_users,
            max_roles=max_roles,
            max_groups=max_groups,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )
