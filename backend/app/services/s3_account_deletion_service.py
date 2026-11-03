# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db import AccountIAMUser, S3Account, StorageEndpoint, UiGroupS3Account, UserS3Account
from app.services.resource_deletion_purge_service import ResourceDeletionPurgeService
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.rgw_account_topics_resolver import RgwAccountTopicsResolver
from app.services.s3_account_iam_cleanup_service import S3AccountIamCleanupService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_rgw_users_service import S3AccountRgwUsersService
from app.services.tags_service import TagsService
from app.utils.storage_endpoint_features import (
    features_to_capabilities,
    normalize_features,
    resolve_feature_flags,
)
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED


class S3AccountDeletionService:
    """Delete persisted S3 accounts and their remote RGW resources safely."""

    def __init__(
        self,
        db: Session,
        *,
        metrics: S3AccountMetricsService | None = None,
        rgw_users: S3AccountRgwUsersService | None = None,
        account_topics: RgwAccountTopicsResolver | None = None,
        account_roots: RgwAccountRootService | None = None,
        iam_cleanup: S3AccountIamCleanupService | None = None,
    ) -> None:
        self.db = db
        self.metrics = metrics or S3AccountMetricsService()
        self.account_roots = account_roots or RgwAccountRootService()
        self.rgw_users = rgw_users or S3AccountRgwUsersService(self.account_roots)
        self.account_topics = account_topics or RgwAccountTopicsResolver()
        self.iam_cleanup = iam_cleanup or S3AccountIamCleanupService(db)
        self.tags = TagsService(db)

    def delete_account(
        self,
        account: S3Account,
        *,
        delete_rgw: bool = False,
        admin: RGWAdminClient | None = None,
        endpoint: StorageEndpoint | None = None,
    ) -> None:
        ResourceDeletionPurgeService(self.db).validate_execution_context_cleanup(
            str(account.id)
        )
        if delete_rgw:
            if admin is None or endpoint is None:
                raise ValueError("RGW account deletion context is unavailable.")
            self._delete_remote_account(account, endpoint, admin)
        self._delete_local_account(account)

    def _delete_remote_account(
        self,
        account: S3Account,
        endpoint: StorageEndpoint,
        admin: RGWAdminClient,
    ) -> None:
        account_identifier = account.rgw_account_id
        endpoint_capabilities = features_to_capabilities(
            normalize_features(endpoint.provider, endpoint.features)
        )

        # Safety: only allow RGW deletion when we can prove the account is empty.
        _, _, bucket_count = self.metrics.get_usage(account)
        if bucket_count is None:
            raise ValueError(
                "Unable to verify bucket existence; cannot delete the RGW account."
            )
        rgw_user_count, _ = self.rgw_users.resolve(
            account_identifier,
            None,
            admin,
            endpoint_capabilities=endpoint_capabilities,
            root_uid=account.rgw_user_uid,
        )
        iam_can_verify_users = resolve_feature_flags(endpoint).iam_enabled
        if rgw_user_count is None and not iam_can_verify_users:
            raise ValueError(
                "Unable to verify RGW users; cannot delete the RGW account."
            )
        rgw_topic_count, _ = self.account_topics.resolve(
            account_identifier,
            admin,
            account.storage_endpoint_id,
        )
        if rgw_topic_count is None:
            raise ValueError(
                "Unable to verify RGW notification topics; cannot delete the RGW account."
            )
        if bucket_count > 0 or (rgw_user_count or 0) > 0 or rgw_topic_count > 0:
            raise ValueError(
                "RGW account still has attached resources "
                f"(buckets={bucket_count}, users={rgw_user_count or 0}, topics={rgw_topic_count}); "
                "remove them first."
            )

        # Standard Ceph AccountInfo omits user_list. IAM ListUsers is scoped by
        # the account root credentials and proves that no non-root users remain
        # without enumerating every RGW user on the endpoint.
        self.iam_cleanup.prepare(account, endpoint)
        self._delete_root_user(account, admin)
        try:
            admin.delete_account(account_identifier)
        except RGWAdminError as exc:
            raise ValueError(
                f"Unable to delete RGW account {account_identifier}: {exc}"
            ) from exc

    def _delete_root_user(
        self,
        account: S3Account,
        admin: RGWAdminClient,
    ) -> None:
        self.account_roots.delete_root_user(
            admin,
            root_uid=account.rgw_user_uid,
            account_id=account.rgw_account_id,
            tenant=account.rgw_tenant,
            local_account_id=account.id,
        )

    def _delete_local_account(self, account: S3Account) -> None:
        try:
            self.db.execute(
                delete(AccountIAMUser).where(AccountIAMUser.account_id == account.id)
            )
            self.db.execute(
                delete(UserS3Account).where(UserS3Account.account_id == account.id)
            )
            self.db.execute(
                delete(UiGroupS3Account)
                .where(UiGroupS3Account.account_id == account.id)
                .execution_options(synchronize_session=False)
            )
            purge = ResourceDeletionPurgeService(self.db)
            purge.purge_account_derived_data(account.id)
            purge.purge_execution_context_data(str(account.id))
            self.db.delete(account)
            self.db.flush()
            self.tags.cleanup_orphan_definitions(
                domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED]
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
