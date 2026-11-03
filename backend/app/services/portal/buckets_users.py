# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0

from __future__ import annotations

import logging
from typing import Optional, TYPE_CHECKING

from sqlalchemy import select

from app.db import AccountIAMUser, PortalIAMRevocation, S3Account, User
from app.core.domain_enums import PortalAccountRole
from app.models.app_settings import PortalEffectiveSettings
from app.models.bucket import Bucket
from app.services import s3_bucket_access, s3_bucket_metadata, s3_client, s3_deletion
from app.services.bucket_ui_tags_service import BucketUiTagsService, PhysicalBucketTarget
from app.services.portal.exceptions import PortalConflictError, PortalForbiddenError
from app.services.portal.iam_revocation import PortalIAMRevocationPreparation
from app.services.rgw_iam import RGWIAMService
from app.services.storage_ops_context_resolution import resolve_storage_ops_context_tenant
from app.utils.account_roles import PortalAccountRoleValue
from app.utils.normalize import normalize_string_list

if TYPE_CHECKING:
    from app.services.access_context_contracts import AccountAccess


logger = logging.getLogger(__name__)


class PortalBucketsUsersMixin:
    @staticmethod
    def _restore_portal_iam_key_statuses(
        iam_service: RGWIAMService,
        *,
        iam_username: str,
        restore_key_statuses: list[tuple[str, str]] | tuple[tuple[str, str], ...],
        context: str,
    ) -> bool:
        failed = False
        for access_key_id, previous_status in reversed(restore_key_statuses):
            try:
                iam_service.update_access_key_status(
                    iam_username,
                    access_key_id,
                    previous_status,
                )
            except Exception as exc:  # pragma: no cover - defensive remote failure
                logger.error(
                    "Unable to restore Portal IAM access key %s %s: %s",
                    access_key_id,
                    context,
                    exc,
                )
                failed = True
        return failed

    def _prepare_portal_iam_revocation(
        self,
        target: User,
        account: S3Account,
    ) -> Optional[PortalIAMRevocationPreparation]:
        pending = self.db.scalar(
            select(PortalIAMRevocation).where(
                PortalIAMRevocation.user_id == target.id,
                PortalIAMRevocation.account_id == account.id,
            )
        )
        if pending is not None:
            return PortalIAMRevocationPreparation(
                user_id=int(target.id),
                account_id=int(account.id),
                iam_username=pending.iam_username,
                restore_key_statuses=(),
                already_pending=True,
            )

        link = self._existing_portal_link(target, account)
        if link is None:
            return None

        restored_statuses: list[tuple[str, str]] = []
        if link.iam_username:
            iam_service = self._get_iam_service(account)
            remote_user = iam_service.get_user(link.iam_username)
            if remote_user is not None:
                try:
                    for key in iam_service.list_access_keys(link.iam_username):
                        previous_status = key.status or "Active"
                        if previous_status == "Inactive":
                            continue
                        iam_service.update_access_key_status(
                            link.iam_username,
                            key.access_key_id,
                            "Inactive",
                        )
                        restored_statuses.append((key.access_key_id, previous_status))
                except Exception as exc:
                    rollback_failed = self._restore_portal_iam_key_statuses(
                        iam_service,
                        iam_username=link.iam_username,
                        restore_key_statuses=restored_statuses,
                        context="after revocation preparation failed",
                    )
                    if rollback_failed:
                        raise RuntimeError(
                            "Unable to prepare Portal IAM revocation. Remote rollback also failed."
                        ) from exc
                    raise

        try:
            self.db.add(
                PortalIAMRevocation(
                    user_id=int(target.id),
                    account_id=int(account.id),
                    iam_user_id=link.iam_user_id,
                    iam_username=link.iam_username,
                )
            )
            self.db.delete(link)
            self.db.flush()
        except Exception as exc:
            remote_rollback_failed = False
            if link.iam_username and restored_statuses:
                remote_rollback_failed = self._restore_portal_iam_key_statuses(
                    self._get_iam_service(account),
                    iam_username=link.iam_username,
                    restore_key_statuses=restored_statuses,
                    context="after local revocation preparation failed",
                )
            if remote_rollback_failed:
                raise RuntimeError(
                    "Unable to prepare Portal IAM revocation. Remote rollback also failed."
                ) from exc
            raise
        return PortalIAMRevocationPreparation(
            user_id=int(target.id),
            account_id=int(account.id),
            iam_username=link.iam_username,
            restore_key_statuses=tuple(restored_statuses),
        )

    def _rollback_portal_iam_revocation(
        self,
        preparation: PortalIAMRevocationPreparation,
    ) -> bool:
        if preparation.already_pending or not preparation.iam_username:
            return False
        account = self.db.get(S3Account, preparation.account_id)
        if account is None:
            logger.error(
                "Unable to restore Portal IAM revocation for missing account %s",
                preparation.account_id,
            )
            return True
        iam_service = self._get_iam_service(account)
        return self._restore_portal_iam_key_statuses(
            iam_service,
            iam_username=preparation.iam_username,
            restore_key_statuses=preparation.restore_key_statuses,
            context="after database rollback",
        )

    def _finalize_portal_iam_revocation(
        self,
        *,
        user_id: int,
        account_id: int,
    ) -> bool:
        pending = self.db.scalar(
            select(PortalIAMRevocation).where(
                PortalIAMRevocation.user_id == user_id,
                PortalIAMRevocation.account_id == account_id,
            )
        )
        if pending is None:
            return False
        account = self.db.get(S3Account, account_id)
        if account is None:
            raise RuntimeError("Portal IAM revocation account no longer exists")
        try:
            if pending.iam_username:
                self._delete_portal_iam_user(
                    self._get_iam_service(account),
                    pending.iam_username,
                )
            self._sync_account_storage_space_bucket_policies(account)
            self._sync_portal_server_access_log_bucket_policy_if_present(account)
            self.db.delete(pending)
            self.db.commit()
        except Exception as exc:
            self.db.rollback()
            raise RuntimeError(
                "Portal IAM revocation is pending because cleanup failed. Retry reconciliation."
            ) from exc
        return True

    def _apply_bucket_creation_defaults(
        self,
        account: S3Account,
        bucket_name: str,
        portal_settings: PortalEffectiveSettings,
        *,
        versioning_enabled: bool,
        access_key: str,
        secret_key: str,
    ) -> None:
        if versioning_enabled:
            s3_client.set_bucket_versioning(
                bucket_name,
                enabled=True,
                access_key=access_key,
                secret_key=secret_key,
                **self._s3_client_kwargs(account),
            )
        if portal_settings.bucket_defaults.enable_lifecycle:
            s3_bucket_metadata.put_bucket_lifecycle(
                bucket_name,
                rules=self._portal_bucket_lifecycle_rules(
                    portal_settings.bucket_defaults.noncurrent_version_expiration_days
                ),
                access_key=access_key,
                secret_key=secret_key,
                **self._s3_client_kwargs(account),
            )
        if portal_settings.bucket_defaults.enable_cors:
            origins = normalize_string_list(portal_settings.bucket_defaults.cors_allowed_origins)
            if origins:
                s3_bucket_access.put_bucket_cors(
                    bucket_name,
                    rules=self._portal_bucket_cors_rules(origins),
                    access_key=access_key,
                    secret_key=secret_key,
                    **self._s3_client_kwargs(account),
                )

    def create_bucket(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        versioning: Optional[bool] = None,
        portal_settings: Optional[PortalEffectiveSettings] = None,
    ) -> Bucket:
        account = access.account
        portal_defaults = portal_settings or self.get_effective_portal_settings(account)
        versioning_flag = portal_defaults.bucket_defaults.versioning if versioning is None else versioning
        is_portal_user_creation = bool(
            access.portal_role == PortalAccountRole.PORTAL_USER.value and portal_defaults.allow_private_storage_space_create
        )
        can_create_bucket = bool(access.capabilities.can_manage_buckets or is_portal_user_creation)
        if not can_create_bucket:
            raise PortalForbiddenError("Bucket creation not allowed for this role.")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            access.portal_role,
            account=account,
        )
        # Keep the Portal identity ready for subsequent object access; bucket
        # creation itself is a controlled backend workflow.
        self._active_credentials(link, iam_service)
        bucket_access_key, bucket_secret = self._account_credentials(account)
        s3_client.create_bucket(
            bucket_name,
            access_key=bucket_access_key,
            secret_key=bucket_secret,
            **self._s3_client_kwargs(account),
        )
        self._apply_bucket_creation_defaults(
            account,
            bucket_name,
            portal_defaults,
            versioning_enabled=bool(versioning_flag),
            access_key=bucket_access_key,
            secret_key=bucket_secret,
        )
        return Bucket(
            name=bucket_name,
            creation_date=None,
            used_bytes=None,
            object_count=None,
            quota_max_size_bytes=None,
            quota_max_objects=None,
        )

    def delete_bucket(
        self,
        user: User,
        access: "AccountAccess",
        bucket_name: str,
        force: bool = False,
        use_root: bool = False,
    ) -> None:
        account = access.account
        if use_root:
            access_key, secret_key = self._account_credentials(account)
        else:
            iam_service = self._get_iam_service(account)
            link, _, _ = self._ensure_portal_user(user, account, iam_service)
            self._sync_user_group_membership(
                iam_service,
                link.iam_username,
                access.portal_role,
                account=account,
            )
            access_key, secret_key = self._active_credentials(link, iam_service)
        s3_deletion.delete_bucket(
            bucket_name,
            force=force,
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(account),
        )
        BucketUiTagsService(self.db).remove_all_namespaces_for_bucket(
            PhysicalBucketTarget.create(
                int(account.storage_endpoint_id),
                resolve_storage_ops_context_tenant(account),
                bucket_name,
            )
        )

    def delete_empty_bucket(
        self,
        access: "AccountAccess",
        bucket_name: str,
    ) -> bool:
        account = access.account
        access_key, secret_key = self._account_credentials(account)
        deleted = s3_deletion.delete_empty_bucket(
            bucket_name,
            access_key=access_key,
            secret_key=secret_key,
            **self._s3_client_kwargs(account),
        )
        BucketUiTagsService(self.db).remove_all_namespaces_for_bucket(
            PhysicalBucketTarget.create(
                int(account.storage_endpoint_id),
                resolve_storage_ops_context_tenant(account),
                bucket_name,
            )
        )
        return deleted

    def provision_portal_user(self, target: User, account: S3Account, portal_role: str) -> None:
        """Create/sync IAM user and group membership immediately when roles change."""
        if portal_role not in {
            PortalAccountRole.PORTAL_MANAGER.value,
            PortalAccountRole.PORTAL_USER.value,
        }:
            raise ValueError("Portal role is required for IAM provisioning")
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(target, account, iam_service)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            portal_role,
            account=account,
        )
        self._sync_user_storage_space_projection(
            target,
            account,
            portal_role,
            iam_service,
            link.iam_username,
        )
        self._ensure_active_key(link, iam_service)
        self._sync_account_storage_space_bucket_policies(account)

    def sync_existing_portal_user_access(
        self,
        target: User,
        account: S3Account,
        portal_role: PortalAccountRoleValue,
    ) -> None:
        """Synchronize an existing IAM identity without creating credentials.

        Active-role reconciliation updates the existing remote identity without
        creating credentials. Durable role removal is coordinated by
        ``commit_portal_role_changes`` so local access removal is committed
        before destructive IAM cleanup.
        """
        link = self.db.scalar(
            select(AccountIAMUser).where(
                AccountIAMUser.user_id == target.id,
                AccountIAMUser.account_id == account.id,
            )
        )
        if not link:
            return

        if portal_role not in {
            PortalAccountRole.PORTAL_MANAGER.value,
            PortalAccountRole.PORTAL_USER.value,
        }:
            raise ValueError("Portal role is required for IAM reconciliation")

        iam_service = self._get_iam_service(account)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            portal_role,
            account=account,
        )
        self._sync_user_storage_space_projection(
            target,
            account,
            portal_role,
            iam_service,
            link.iam_username,
        )
        self._sync_account_storage_space_bucket_policies(account)

    def _delete_portal_iam_user(self, iam_service: RGWIAMService, iam_username: str) -> None:
        iam_user = iam_service.get_user(iam_username)
        if iam_user is None:
            iam_service.delete_user(iam_username)
            return
        for key in iam_service.list_access_keys(iam_username):
            iam_service.delete_access_key(iam_username, key.access_key_id)
        for policy in iam_service.list_user_policies(iam_username):
            if policy.arn:
                iam_service.detach_user_policy(iam_username, policy.arn)
        for policy_name in iam_service.list_user_inline_policies(iam_username):
            iam_service.delete_user_inline_policy(iam_username, policy_name)
        for group in iam_service.list_groups_for_user(iam_username):
            iam_service.remove_user_from_group(group.name, iam_username)
        iam_service.delete_user(iam_username)

    def revoke_portal_user(self, target: User, account: S3Account) -> None:
        """Durably revoke one stale Portal IAM identity outside a role transaction."""
        from app.services.portal_ownership import require_no_private_storage_space_ownership

        require_no_private_storage_space_ownership(
            self.db,
            user_id=target.id,
            account_id=account.id,
        )
        preparation = self._prepare_portal_iam_revocation(target, account)
        if preparation is None:
            return
        try:
            self.db.commit()
        except Exception as exc:
            self.db.rollback()
            if self._rollback_portal_iam_revocation(preparation):
                raise RuntimeError(
                    "Unable to persist Portal IAM revocation. Remote rollback also failed."
                ) from exc
            raise
        self._finalize_portal_iam_revocation(
            user_id=int(target.id),
            account_id=int(account.id),
        )
