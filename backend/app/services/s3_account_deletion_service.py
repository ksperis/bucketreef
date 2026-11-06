# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import commit_or_rollback
from app.core.sensitive_data import sanitized_error_log_detail
from app.db import (
    AccountIAMUser,
    S3Account,
    S3AccountDeletion,
    StorageEndpoint,
    UiGroupS3Account,
    UserS3Account,
)
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
    resolve_feature_flags,
    validate_persisted_features,
)
from app.utils.rgw_payloads import extract_rgw_account_id
from app.utils.tagging import TAG_DOMAIN_ADMIN_MANAGED
from app.utils.time import utcnow


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
        deletion = self._pending_deletion(account.id)
        if not delete_rgw:
            if deletion is not None:
                raise ValueError(
                    "RGW account deletion is pending; retry deletion with RGW cleanup enabled"
                )
            self._delete_local_account(account)
            return

        if admin is None or endpoint is None:
            raise ValueError("RGW account deletion context is unavailable.")

        if deletion is None:
            remote = self._load_remote_account(account, admin)
            if remote is None:
                self._delete_local_account(account)
                return
            self._require_remote_account_empty(account, endpoint, admin)
            deletion = self._claim_deletion(account, endpoint)
        else:
            self._validate_pending_deletion(deletion, account, endpoint)

        if not deletion.iam_cleanup_completed:
            self._require_remote_account_empty(account, endpoint, admin)
            self.iam_cleanup.prepare(account, endpoint)
            self._checkpoint(deletion, "iam_cleanup_completed")

        if not deletion.root_user_deleted:
            if self._root_user_exists(account, admin):
                self._require_remote_account_empty(account, endpoint, admin)
                self._delete_root_user(account, admin)
            self._checkpoint(deletion, "root_user_deleted")

        if not deletion.remote_account_deleted:
            if self._load_remote_account(account, admin) is not None:
                self._delete_remote_account(account, admin)
            self._checkpoint(deletion, "remote_account_deleted")

        self._delete_local_account(account, deletion=deletion)

    def _pending_deletion(self, account_id: int) -> S3AccountDeletion | None:
        return self.db.scalar(
            select(S3AccountDeletion).where(
                S3AccountDeletion.account_id == account_id
            )
        )

    def _claim_deletion(
        self,
        account: S3Account,
        endpoint: StorageEndpoint,
    ) -> S3AccountDeletion:
        deletion = S3AccountDeletion(
            account_id=account.id,
            rgw_account_id=account.rgw_account_id,
            rgw_user_uid=account.rgw_user_uid,
            rgw_tenant=account.rgw_tenant,
            storage_endpoint_id=endpoint.id,
            iam_cleanup_completed=False,
            root_user_deleted=False,
            remote_account_deleted=False,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        self.db.add(deletion)
        try:
            commit_or_rollback(self.db)
        except IntegrityError:
            existing = self._pending_deletion(account.id)
            if existing is None:
                raise
            self._validate_pending_deletion(existing, account, endpoint)
            return existing
        self.db.refresh(deletion)
        return deletion

    @staticmethod
    def _validate_pending_deletion(
        deletion: S3AccountDeletion,
        account: S3Account,
        endpoint: StorageEndpoint,
    ) -> None:
        if (
            deletion.rgw_account_id != account.rgw_account_id
            or deletion.rgw_user_uid != account.rgw_user_uid
            or deletion.rgw_tenant != account.rgw_tenant
            or deletion.storage_endpoint_id != account.storage_endpoint_id
            or deletion.storage_endpoint_id != endpoint.id
        ):
            raise ValueError("S3 account identity changed while deletion was pending")

    def _checkpoint(self, deletion: S3AccountDeletion, field: str) -> None:
        setattr(deletion, field, True)
        deletion.updated_at = utcnow()
        commit_or_rollback(self.db)
        self.db.refresh(deletion)

    def _load_remote_account(
        self,
        account: S3Account,
        admin: RGWAdminClient,
    ) -> dict | None:
        account_identifier = account.rgw_account_id
        try:
            remote = admin.get_account(account_identifier, allow_not_found=True)
        except RGWAdminError as exc:
            raise ValueError(
                "Unable to verify RGW account before deletion: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        if remote is not None:
            remote_id = extract_rgw_account_id(remote)
            if remote_id != account_identifier:
                raise ValueError("RGW account identity could not be verified")
            return remote

        try:
            accounts = admin.list_accounts(include_details=False)
        except RGWAdminError as exc:
            raise ValueError(
                "Unable to confirm missing RGW account before deletion: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        if any(
            extract_rgw_account_id(candidate) == account_identifier
            for candidate in accounts
        ):
            raise ValueError(
                "RGW account still exists but its detail could not be verified"
            )
        return None

    def _require_remote_account_empty(
        self,
        account: S3Account,
        endpoint: StorageEndpoint,
        admin: RGWAdminClient,
    ) -> None:
        account_identifier = account.rgw_account_id
        endpoint_capabilities = features_to_capabilities(
            validate_persisted_features(endpoint.provider, endpoint.features)
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

    def _root_user_exists(
        self,
        account: S3Account,
        admin: RGWAdminClient,
    ) -> bool:
        try:
            root = self.account_roots.load_existing_root_user(
                admin,
                account.rgw_user_uid,
                account.rgw_account_id,
                account.rgw_tenant,
            )
        except RGWAdminError as exc:
            raise ValueError(
                "Unable to verify RGW root user before account deletion: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        if root is not None:
            return True

        try:
            admin.get_user(
                account.rgw_user_uid,
                tenant=account.rgw_tenant or None,
                allow_not_found=False,
            )
        except RGWAdminError as exc:
            if exc.status_code == 404 and exc.error_code == "NoSuchUser":
                return False
            raise ValueError(
                "Unable to verify RGW root user before account deletion: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        raise ValueError("RGW root user could not be verified")

    def _delete_remote_account(
        self,
        account: S3Account,
        admin: RGWAdminClient,
    ) -> None:
        account_identifier = account.rgw_account_id
        try:
            result = admin.delete_account(account_identifier)
        except RGWAdminError as exc:
            raise ValueError(
                f"Unable to delete RGW account {account_identifier}: "
                f"{sanitized_error_log_detail(exc)}"
            ) from exc
        if isinstance(result, dict) and result.get("not_implemented"):
            raise ValueError("RGW account deletion API is not available")
        if isinstance(result, dict) and result.get("not_found"):
            if self._load_remote_account(account, admin) is None:
                return
            raise ValueError("RGW account deletion returned not found for an existing account")

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

    def _delete_local_account(
        self,
        account: S3Account,
        *,
        deletion: S3AccountDeletion | None = None,
    ) -> None:
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
            if deletion is not None:
                self.db.delete(deletion)
            self.db.delete(account)
            self.db.flush()
            self.tags.cleanup_orphan_definitions(
                domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED]
            )
        except Exception:
            self.db.rollback()
            raise
        commit_or_rollback(self.db)
