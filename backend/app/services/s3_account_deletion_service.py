# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import time

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db_transactions import run_replayable_db_unit
from app.core.domain_errors import CompensationFailureError
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
from app.services.managed_private_access_query_service import (
    ManagedPrivateAccessQueryService,
)
from app.services.rgw_admin import RGWAdminClient, RGWAdminError
from app.services.rgw_account_root_service import RgwAccountRootService
from app.services.rgw_account_topics_resolver import RgwAccountTopicsResolver
from app.services import s3_client
from app.services.s3_client import S3OperationError
from app.services.s3_account_iam_cleanup_service import S3AccountIamCleanupService
from app.services.s3_account_metrics_service import S3AccountMetricsService
from app.services.s3_account_rgw_users_service import S3AccountRgwUsersService
from app.services.s3_execution_client import s3_execution_request_kwargs
from app.services.s3_execution_context import S3ExecutionContext
from app.services.tags_service import TagsService
from app.utils.storage_endpoint_features import (
    resolve_endpoint_capabilities,
    resolve_feature_flags,
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
        self.managed_private_access_queries = ManagedPrivateAccessQueryService(db)

    def delete_account(
        self,
        account: S3Account,
        *,
        delete_rgw: bool = False,
        admin: RGWAdminClient | None = None,
        endpoint: StorageEndpoint | None = None,
    ) -> None:
        if self.managed_private_access_queries.has_active_source(
            "account",
            int(account.id),
        ):
            raise ValueError(
                "Delete managed private accesses created from this source account first"
            )
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

        deletion = self._prepare_remote_deletion(account, deletion, admin, endpoint)
        if deletion is None:
            return

        self._resume_remote_deletion(account, deletion, admin, endpoint)
        self._delete_local_account(account, deletion=deletion)

    def _prepare_remote_deletion(
        self,
        account: S3Account,
        deletion: S3AccountDeletion | None,
        admin: RGWAdminClient,
        endpoint: StorageEndpoint,
    ) -> S3AccountDeletion | None:
        if deletion is not None:
            self._validate_pending_deletion(deletion, account, endpoint)
            return deletion

        remote = self._load_remote_account(account, admin)
        if remote is None:
            self._delete_local_account(account)
            return None

        self._require_remote_account_empty(account, endpoint, admin)
        return self._claim_deletion(account, endpoint)

    def _resume_remote_deletion(
        self,
        account: S3Account,
        deletion: S3AccountDeletion,
        admin: RGWAdminClient,
        endpoint: StorageEndpoint,
    ) -> None:
        if not deletion.iam_cleanup_completed:
            self._require_remote_account_empty(account, endpoint, admin)
            self.iam_cleanup.prepare(account, endpoint)
            deletion = self._checkpoint(deletion, "iam_cleanup_completed")

        if not deletion.root_user_deleted:
            if self._root_user_exists(account, admin):
                self._require_remote_account_empty(account, endpoint, admin)
                self._delete_root_user(account, admin)
            deletion = self._checkpoint(deletion, "root_user_deleted")

        if not deletion.remote_account_deleted:
            try:
                self._delete_remote_account(account, admin)
            except Exception:
                remote_deleted = self._recover_after_failed_remote_account_delete(
                    account,
                    deletion,
                    admin,
                )
                if remote_deleted:
                    return
                raise
            self._checkpoint(deletion, "remote_account_deleted")

    def _recover_after_failed_remote_account_delete(
        self,
        account: S3Account,
        deletion: S3AccountDeletion,
        admin: RGWAdminClient,
    ) -> bool:
        """Restore the root identity when RGW rejects account deletion.

        The root user has already been deleted and durably checkpointed before
        this method runs. If the account still exists, restore usable root
        credentials and reset that checkpoint so a later deletion retry starts
        from a consistent remote/local state. If RGW actually deleted the
        account despite returning an error, checkpoint that completed effect.
        """
        try:
            remote = self._load_remote_account(account, admin)
        except Exception as compensation_error:
            raise CompensationFailureError(
                "Unable to delete S3 account. RGW account state could not be "
                "verified after root-user deletion."
            ) from compensation_error

        if remote is None:
            self._checkpoint(deletion, "remote_account_deleted")
            return True

        try:
            root_uid, access_key, secret_key = (
                self.account_roots.ensure_provisioned_credentials(
                    admin,
                    rgw_account_id=account.rgw_account_id,
                    account_name=account.name,
                    resume=True,
                    tenant=account.rgw_tenant,
                )
            )
            self._persist_restored_root_identity(
                account_id=int(account.id),
                deletion_id=int(deletion.id),
                root_uid=root_uid,
                access_key=access_key,
                secret_key=secret_key,
            )
        except Exception as compensation_error:
            raise CompensationFailureError(
                "Unable to delete S3 account. RGW root-user restoration also failed."
            ) from compensation_error

        return False

    def _persist_restored_root_identity(
        self,
        *,
        account_id: int,
        deletion_id: int,
        root_uid: str,
        access_key: str,
        secret_key: str,
    ) -> None:
        updated_at = utcnow()

        def persist_once(write_db: Session) -> None:
            current_account = write_db.get(S3Account, account_id)
            current_deletion = write_db.get(S3AccountDeletion, deletion_id)
            if current_account is None or current_deletion is None:
                raise RuntimeError(
                    "S3 account deletion state disappeared during root-user restoration"
                )

            current_account.rgw_user_uid = root_uid
            current_account.rgw_access_key = access_key
            current_account.rgw_secret_key = secret_key
            current_deletion.rgw_user_uid = root_uid
            current_deletion.root_user_deleted = False
            current_deletion.remote_account_deleted = False
            current_deletion.updated_at = updated_at

        run_replayable_db_unit(self.db, persist_once)

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
        account_id = int(account.id)
        rgw_account_id = account.rgw_account_id
        rgw_user_uid = account.rgw_user_uid
        rgw_tenant = account.rgw_tenant
        endpoint_id = int(endpoint.id)
        created_at = utcnow()
        updated_at = utcnow()

        def claim_once(write_db: Session) -> int:
            existing_id = write_db.scalar(
                select(S3AccountDeletion.id).where(
                    S3AccountDeletion.account_id == account_id
                )
            )
            if existing_id is not None:
                return int(existing_id)
            deletion = S3AccountDeletion(
                account_id=account_id,
                rgw_account_id=rgw_account_id,
                rgw_user_uid=rgw_user_uid,
                rgw_tenant=rgw_tenant,
                storage_endpoint_id=endpoint_id,
                iam_cleanup_completed=False,
                root_user_deleted=False,
                remote_account_deleted=False,
                created_at=created_at,
                updated_at=updated_at,
            )
            write_db.add(deletion)
            write_db.flush()
            deletion_id = int(deletion.id)
            return deletion_id

        try:
            deletion_id = run_replayable_db_unit(self.db, claim_once)
        except IntegrityError:
            self.db.rollback()
            existing = self._pending_deletion(account_id)
            if existing is None:
                raise
            self._validate_pending_deletion(existing, account, endpoint)
            return existing
        deletion = self.db.get(
            S3AccountDeletion,
            deletion_id,
            populate_existing=True,
        )
        if deletion is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("Pending S3 account deletion could not be reloaded")
        self._validate_pending_deletion(deletion, account, endpoint)
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

    def _checkpoint(
        self,
        deletion: S3AccountDeletion,
        field: str,
    ) -> S3AccountDeletion:
        deletion_id = int(deletion.id)
        updated_at = utcnow()

        def checkpoint_once(write_db: Session) -> int:
            current = write_db.get(S3AccountDeletion, deletion_id)
            if current is None:
                raise RuntimeError("Pending S3 account deletion disappeared")
            setattr(current, field, True)
            current.updated_at = updated_at
            return deletion_id

        run_replayable_db_unit(self.db, checkpoint_once)
        current = self.db.get(
            S3AccountDeletion,
            deletion_id,
            populate_existing=True,
        )
        if current is None:  # pragma: no cover - defensive consistency check
            raise RuntimeError("Pending S3 account deletion could not be reloaded")
        return current

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
        endpoint_capabilities = resolve_endpoint_capabilities(endpoint)

        # Safety: only allow RGW deletion when we can prove the account is empty.
        bucket_count = self._verified_bucket_count(account)
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

    def _verified_bucket_count(self, account: S3Account) -> int:
        access_key, secret_key = account.effective_rgw_credentials()
        execution_context = S3ExecutionContext.from_account(
            account,
            access_key=access_key,
            secret_key=secret_key,
        )
        _, _, admin_bucket_count = self.metrics.get_usage(execution_context)
        if admin_bucket_count is not None and admin_bucket_count > 0:
            return admin_bucket_count

        if not access_key or not secret_key:
            if admin_bucket_count is None:
                raise ValueError(
                    "Unable to verify bucket existence; cannot delete the RGW account."
                )
            return admin_bucket_count

        try:
            buckets = s3_client.list_buckets(
                **s3_execution_request_kwargs(
                    execution_context,
                    error_message=(
                        "S3 account credentials are unavailable for deletion verification"
                    ),
                )
            )
        except S3OperationError as exc:
            raise ValueError(
                "Unable to verify bucket existence through the RGW account credentials; "
                "cannot delete the RGW account."
            ) from exc

        return max(admin_bucket_count or 0, len(buckets))

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
        retry_delays = iter((0.05, 0.1, 0.25))
        while True:
            try:
                result = admin.delete_account(account_identifier)
                break
            except RGWAdminError as exc:
                if exc.error_code != "ConcurrentModification":
                    raise ValueError(
                        f"Unable to delete RGW account {account_identifier}: "
                        f"{sanitized_error_log_detail(exc)}"
                    ) from exc
                try:
                    delay = next(retry_delays)
                except StopIteration:
                    raise ValueError(
                        f"Unable to delete RGW account {account_identifier}: "
                        f"{sanitized_error_log_detail(exc)}"
                    ) from exc
                time.sleep(delay)
        if isinstance(result, dict) and result.get("not_implemented"):
            raise ValueError("RGW account deletion API is not available")
        if isinstance(result, dict) and result.get("not_found"):
            return

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
        account_id = int(account.id)
        deletion_id = int(deletion.id) if deletion is not None else None
        if self.db.get_bind().dialect.name == "sqlite" and account in self.db:
            self.db.expunge(account)

        def delete_once(write_db: Session) -> None:
            current_account = write_db.get(S3Account, account_id)
            if current_account is None:
                return
            write_db.execute(
                delete(AccountIAMUser).where(AccountIAMUser.account_id == account_id)
            )
            write_db.execute(
                delete(UserS3Account).where(UserS3Account.account_id == account_id)
            )
            write_db.execute(
                delete(UiGroupS3Account)
                .where(UiGroupS3Account.account_id == account_id)
                .execution_options(synchronize_session=False)
            )
            purge = ResourceDeletionPurgeService(write_db)
            purge.purge_execution_context_data(str(account_id))
            if deletion_id is not None:
                current_deletion = write_db.get(S3AccountDeletion, deletion_id)
                if current_deletion is not None:
                    write_db.delete(current_deletion)
            write_db.delete(current_account)
            write_db.flush()
            tags = self.tags if write_db is self.db else TagsService(write_db)
            tags.cleanup_orphan_definitions(
                domain_kinds=[TAG_DOMAIN_ADMIN_MANAGED]
            )

        run_replayable_db_unit(self.db, delete_once)
