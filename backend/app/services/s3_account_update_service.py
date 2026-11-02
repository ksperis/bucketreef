# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db import S3Account
from app.core.domain_enums import StorageProvider
from app.models.s3_account import S3Account as S3AccountSchema, S3AccountUpdate
from app.services.app_settings_service import load_app_settings_for_db_readonly
from app.services.feature_policy_service import (
    apply_resource_feature_overrides,
    validate_manager_overrides,
    validate_multisite_endpoint_switching_override,
    validate_project_collection_overrides,
    validate_project_overrides,
)
from app.services.mappers.s3_account import s3_account_from_db
from app.services.portal_role_sync import (
    capture_effective_portal_roles,
    commit_portal_role_changes,
)
from app.services.s3_account_associations_service import S3AccountAssociationsService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_quota_service import S3AccountQuotaService
from app.services.s3_account_repository import S3AccountRepository
from app.services.s3_account_rgw_context_service import S3AccountRgwContextService
from app.services.tags_service import TagsService
from app.utils.storage_endpoint_features import resolve_feature_flags


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
    ) -> None:
        self.db = db
        self.repository = repository or S3AccountRepository(db)
        self.rgw_context = rgw_context or S3AccountRgwContextService(db)
        self.quota = quota or S3AccountQuotaService(self.rgw_context)
        self.metrics = metrics or S3AccountMetricsService()
        self.associations = associations or S3AccountAssociationsService(db)
        self.tags = tags or TagsService(db)

    def update_account(
        self,
        account_id: int,
        payload: S3AccountUpdate,
    ) -> S3AccountSchema:
        account = self.repository.get(account_id)
        affected_portal_user_ids = self.associations.affected_portal_user_ids(
            account,
            payload,
        )
        portal_roles_before = capture_effective_portal_roles(
            self.db,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )

        self._apply_fields(account, payload)
        self._apply_quota(account, payload)
        self._apply_associations(account, payload)
        self.db.add(account)
        self.db.flush()
        commit_portal_role_changes(
            self.db,
            before=portal_roles_before,
            user_ids=affected_portal_user_ids,
            account_ids=[account.id],
        )
        self.db.refresh(account)
        return self._serialize_updated_account(account)

    def _apply_fields(self, account: S3Account, payload: S3AccountUpdate) -> None:
        app_settings = load_app_settings_for_db_readonly(self.db)
        validate_manager_overrides(payload, app_settings.manager.feature_policies, account)
        validate_multisite_endpoint_switching_override(
            payload,
            app_settings.manager.feature_policies,
            account,
        )
        validate_project_overrides(
            payload,
            app_settings.general.project_feature_policies,
            account,
        )
        validate_project_collection_overrides(
            payload,
            app_settings.general.project_collection_policies,
            account,
        )
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
        if payload.email is not None:
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
        quota_max_size_gb, quota_max_objects = self.metrics.get_quota(account)

        return s3_account_from_db(
            account,
            quota_max_size_gb=quota_max_size_gb,
            quota_max_objects=quota_max_objects,
            user_links=user_links,
            group_links=group_links,
            storage_endpoint=endpoint,
            storage_endpoint_capabilities=self.rgw_context.endpoint_capabilities(endpoint),
            tags=self.tags.get_account_tags(account),
        )
