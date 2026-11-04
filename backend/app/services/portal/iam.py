# Copyright (c) 2025 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.db_transactions import commit_or_rollback, rollback_safely
from app.db import AccountIAMUser, PortalIAMRevocation, S3Account, User
from app.core.domain_enums import PortalAccountRole
from app.models.iam import AccessKey as ModelAccessKey, IAMUser
from app.models.portal_access_keys import PortalAccessKey
from app.services.managed_resource_naming import portal_iam_username
from app.services.mappers.portal import portal_access_key_from_active_link, portal_access_key_from_iam_metadata
from app.services.portal.exceptions import PortalConflictError
from app.services.rgw_iam import RGWIAMGroupAlreadyExistsError, RGWIAMService, get_iam_service
from app.utils.account_roles import PortalAccountRoleValue
from app.utils.s3_endpoint import resolve_s3_client_options
from app.utils.storage_endpoint_features import resolve_feature_flags

if TYPE_CHECKING:
    from app.services.access_context_contracts import AccountAccess


logger = logging.getLogger(__name__)

_PORTAL_GROUP_MARKER_RETRY_DELAYS = (0.1, 0.2, 0.4, 0.8)


class PortalIamMixin:
    def _get_iam_service(self, account: S3Account) -> RGWIAMService:
        access_key, secret_key = self._account_credentials(account)
        endpoint, region, _, verify_tls = resolve_s3_client_options(account)
        return get_iam_service(
            access_key,
            secret_key,
            endpoint=endpoint,
            region=region,
            verify_tls=verify_tls,
        )

    def check_eligibility(self, access: "AccountAccess") -> tuple[bool, list[str]]:
        """Return whether the portal can be used for this account context.

        Portal is intended for RGW accounts configured with IAM semantics. This
        shell-level check is strictly local; remote IAM availability is checked
        only by the pages and actions that need it.
        """
        reasons: list[str] = []
        account = access.account
        endpoint = account.storage_endpoint

        flags = resolve_feature_flags(endpoint)
        if not flags.iam_enabled:
            reasons.append("IAM is not enabled for this endpoint")

        return (len(reasons) == 0), reasons

    def _persist_portal_key(self, link: AccountIAMUser, key: ModelAccessKey) -> PortalAccessKey:
        link.active_access_key = key.access_key_id
        link.active_secret_key = key.secret_access_key
        self.db.add(link)
        commit_or_rollback(self.db)
        return portal_access_key_from_iam_metadata(
            key,
            is_portal=True,
            deletable=False,
            secret_access_key=key.secret_access_key,
            is_active=True,
        )

    @staticmethod
    def _set_portal_link_identity(
        link: AccountIAMUser,
        iam_user: IAMUser,
        *,
        fallback_username: str,
    ) -> None:
        link.iam_user_id = iam_user.user_id or iam_user.arn or fallback_username
        link.iam_username = iam_user.name

    def _persist_provisioned_portal_link(
        self,
        user: User,
        account: S3Account,
        link: AccountIAMUser,
        created_key: Optional[ModelAccessKey],
    ) -> AccountIAMUser:
        if created_key:
            link.active_access_key = created_key.access_key_id
            link.active_secret_key = created_key.secret_access_key
        try:
            self.db.add(link)
            commit_or_rollback(self.db)
        except IntegrityError:
            concurrent_link = self._existing_portal_link(user, account)
            if concurrent_link is None:
                raise
            link = concurrent_link
            if created_key and not link.active_access_key:
                self._persist_portal_key(link, created_key)
            return link

        return link

    def _provision_portal_user(
        self,
        user: User,
        account: S3Account,
        iam_service: RGWIAMService,
        link: Optional[AccountIAMUser],
        *,
        expected_username: str,
    ) -> tuple[AccountIAMUser, IAMUser, Optional[ModelAccessKey]]:
        iam_user, created_key = iam_service.create_user(
            expected_username,
            create_key=True,
            allow_existing=False,
        )
        try:
            if link is None:
                link = AccountIAMUser(
                    user_id=user.id,
                    account_id=account.id,
                    iam_user_id=iam_user.user_id or iam_user.arn or expected_username,
                    iam_username=iam_user.name,
                )
            else:
                self._set_portal_link_identity(
                    link,
                    iam_user,
                    fallback_username=expected_username,
                )
                link.active_access_key = None
                link.active_secret_key = None
            link = self._persist_provisioned_portal_link(
                user,
                account,
                link,
                created_key,
            )
        except Exception as exc:
            rollback_error = rollback_safely(self.db)
            if rollback_error is not None:  # pragma: no cover - defensive database failure
                logger.error(
                    "Unable to roll back failed Portal IAM user transaction: %s",
                    rollback_error,
                )
            remote_rollback_failed = self._rollback_provisioned_portal_user(
                iam_service,
                username=expected_username,
                created_key=created_key,
            )
            if rollback_error is not None or remote_rollback_failed:
                raise RuntimeError(
                    "Unable to provision Portal IAM user. Local or IAM rollback also failed."
                ) from exc
            raise

        self.db.refresh(link)
        return link, iam_user, created_key

    @staticmethod
    def _rollback_provisioned_portal_user(
        iam_service: RGWIAMService,
        *,
        username: str,
        created_key: Optional[ModelAccessKey],
    ) -> bool:
        failed = False
        if created_key is not None:
            try:
                iam_service.delete_access_key(username, created_key.access_key_id)
            except Exception as exc:  # pragma: no cover - defensive remote failure
                logger.error(
                    "Unable to remove Portal IAM access key %s after failed provisioning: %s",
                    created_key.access_key_id,
                    exc,
                )
                failed = True
        try:
            iam_service.delete_user(username)
        except Exception as exc:  # pragma: no cover - defensive remote failure
            logger.error(
                "Unable to remove Portal IAM user %s after failed provisioning: %s",
                username,
                exc,
            )
            failed = True
        return failed

    def _ensure_portal_user(
        self,
        user: User,
        account: S3Account,
        iam_service: RGWIAMService,
    ) -> Tuple[AccountIAMUser, Optional[IAMUser], bool]:
        link = self._existing_portal_link(user, account)
        created = False
        iam_user: Optional[IAMUser] = None
        created_key: Optional[ModelAccessKey] = None
        expected_username = portal_iam_username(account.id, user.id)

        pending_revocation = self.db.scalar(
            select(PortalIAMRevocation.id).where(
                PortalIAMRevocation.user_id == user.id,
                PortalIAMRevocation.account_id == account.id,
            )
        )
        if pending_revocation is not None:
            raise PortalConflictError(
                "Portal IAM revocation is pending. Retry reconciliation before provisioning Portal access."
            )

        if link and link.iam_username and link.iam_username != expected_username:
            raise RuntimeError(
                "Stored Portal IAM identity does not match the BucketReef-managed naming contract"
            )

        if link and link.iam_username:
            iam_user = iam_service.get_user(link.iam_username)

        if link is None or iam_user is None:
            link, iam_user, created_key = self._provision_portal_user(
                user,
                account,
                iam_service,
                link,
                expected_username=expected_username,
            )
            created = created_key is not None

        if iam_user is None and link.iam_username:
            iam_user = iam_service.get_user(link.iam_username)

        return link, iam_user, created

    def _ensure_portal_groups(
        self,
        iam_service: RGWIAMService,
        account: Optional[S3Account] = None,
    ) -> None:
        """Ensure portal groups exist and carry the expected policies."""
        groups = {g.name for g in iam_service.list_groups()}
        managed_groups = (
            (
                self._manager_group_name,
                self._manager_group_policy_name,
                self._resolve_group_policy("manager", account),
            ),
            (
                self._user_group_name,
                self._inline_policy_name,
                self._resolve_group_policy("user", account),
            ),
        )

        for group_name, policy_name, _policy_document in managed_groups:
            if group_name in groups:
                self._wait_for_portal_group_marker(iam_service, group_name, policy_name)

        for group_name, policy_name, policy_document in managed_groups:
            if group_name not in groups:
                try:
                    iam_service.create_group(group_name)
                except RGWIAMGroupAlreadyExistsError:
                    self._wait_for_portal_group_marker(iam_service, group_name, policy_name)
            attached = iam_service.list_group_policies(group_name)
            for policy in attached:
                if policy.arn:
                    iam_service.detach_group_policy(group_name, policy.arn)
            iam_service.put_group_inline_policy(
                group_name,
                policy_name,
                policy_document,
            )

    def _wait_for_portal_group_marker(
        self,
        iam_service: RGWIAMService,
        group_name: str,
        policy_name: str,
    ) -> None:
        if iam_service.get_group_inline_policy(group_name, policy_name) is not None:
            return
        for delay in _PORTAL_GROUP_MARKER_RETRY_DELAYS:
            time.sleep(delay)
            if iam_service.get_group_inline_policy(group_name, policy_name) is not None:
                return
        raise RuntimeError(
            f"Refusing to reuse existing IAM group '{group_name}' because it is not marked as BucketReef-managed"
        )

    def _sync_user_group_membership(
        self,
        iam_service: RGWIAMService,
        iam_username: Optional[str],
        portal_role: Optional[PortalAccountRoleValue],
        *,
        account: Optional[S3Account] = None,
    ) -> None:
        if not iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        if portal_role not in {PortalAccountRole.PORTAL_MANAGER.value, PortalAccountRole.PORTAL_USER.value}:
            self._remove_portal_group_memberships(iam_service, iam_username)
            return

        # The manager group grants account-wide S3 data access. Protect the
        # technical bucket before its policy is created or updated, then remove
        # a stale deny only after a manager has left the group.
        if account is not None and portal_role == PortalAccountRole.PORTAL_MANAGER.value:
            self._sync_portal_server_access_log_bucket_policy_if_present(account)

        self._ensure_portal_groups(iam_service, account)
        target_group = self._manager_group_name if portal_role == PortalAccountRole.PORTAL_MANAGER.value else self._user_group_name
        other_group = self._user_group_name if target_group == self._manager_group_name else self._manager_group_name
        remove_other_first = target_group == self._user_group_name
        self._transition_portal_group_membership(
            iam_service,
            iam_username,
            target_group=target_group,
            other_group=other_group,
            remove_other_first=remove_other_first,
        )
        if account is not None and portal_role == PortalAccountRole.PORTAL_USER.value:
            self._sync_portal_server_access_log_bucket_policy_if_present(account)

    def _remove_portal_group_memberships(
        self,
        iam_service: RGWIAMService,
        iam_username: str,
    ) -> None:
        for group in (self._manager_group_name, self._user_group_name):
            try:
                iam_service.remove_user_from_group(group, iam_username)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("Unable to remove %s from %s: %s", iam_username, group, exc)

    @staticmethod
    def _transition_portal_group_membership(
        iam_service: RGWIAMService,
        iam_username: str,
        *,
        target_group: str,
        other_group: str,
        remove_other_first: bool,
    ) -> None:
        other_members = iam_service.list_group_users(other_group)
        is_other_member = any(member.name == iam_username for member in other_members)
        if remove_other_first and is_other_member:
            iam_service.remove_user_from_group(other_group, iam_username)

        members = iam_service.list_group_users(target_group)
        if not any(member.name == iam_username for member in members):
            iam_service.add_user_to_group(target_group, iam_username)

        if not remove_other_first and is_other_member:
            iam_service.remove_user_from_group(other_group, iam_username)

    def _existing_portal_link(self, user: User, account: S3Account) -> Optional[AccountIAMUser]:
        return self.db.scalar(
            select(AccountIAMUser).where(
                AccountIAMUser.user_id == user.id,
                AccountIAMUser.account_id == account.id,
            )
        )

    def _active_credentials(self, link: AccountIAMUser, iam_service: RGWIAMService) -> tuple[str, str]:
        active = self._ensure_active_key(link, iam_service)
        if not active.access_key_id or not active.secret_access_key:
            raise RuntimeError("Active access key is missing for this portal user")
        return active.access_key_id, active.secret_access_key

    def get_portal_credentials(self, user: User, account: S3Account, portal_role: str) -> tuple[str, str]:
        """Expose portal IAM credentials for manager access."""
        iam_service = self._get_iam_service(account)
        link, _, _ = self._ensure_portal_user(user, account, iam_service)
        self._sync_user_group_membership(
            iam_service,
            link.iam_username,
            portal_role,
            account=account,
        )
        self._sync_user_storage_space_projection(user, account, portal_role, iam_service, link.iam_username)
        return self._active_credentials(link, iam_service)

    def _ensure_active_key(self, link: AccountIAMUser, iam_service: RGWIAMService) -> PortalAccessKey:
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        key_list = iam_service.list_access_keys(link.iam_username)
        active = next((k for k in key_list if k.access_key_id == link.active_access_key), None)
        if active:
            if not link.active_secret_key:
                new_key = iam_service.create_access_key(link.iam_username)
                return self._activate_replacement_portal_key(
                    link,
                    iam_service,
                    new_key,
                    previous_keys=key_list,
                )
            result = portal_access_key_from_iam_metadata(
                active,
                is_portal=True,
                deletable=False,
                secret_access_key=link.active_secret_key,
                is_active=True,
            )
            self._delete_stale_portal_keys(
                iam_service,
                link.iam_username,
                key_list,
                preserve_access_key=active.access_key_id,
            )
            return result
        new_key = iam_service.create_access_key(link.iam_username)
        return self._activate_replacement_portal_key(
            link,
            iam_service,
            new_key,
            previous_keys=key_list,
        )

    def _activate_replacement_portal_key(
        self,
        link: AccountIAMUser,
        iam_service: RGWIAMService,
        new_key: ModelAccessKey,
        *,
        previous_keys: list[ModelAccessKey],
    ) -> PortalAccessKey:
        try:
            result = self._persist_portal_key(link, new_key)
        except Exception as exc:
            rollback_error = rollback_safely(self.db)
            if rollback_error is not None:  # pragma: no cover - defensive database failure
                logger.error(
                    "Unable to roll back failed Portal IAM key activation: %s",
                    rollback_error,
                )
            remote_rollback_failed = False
            try:
                iam_service.delete_access_key(link.iam_username, new_key.access_key_id)
            except Exception as rollback_exc:  # pragma: no cover - defensive remote failure
                logger.error(
                    "Unable to remove new Portal IAM access key %s after failed activation: %s",
                    new_key.access_key_id,
                    rollback_exc,
                )
                remote_rollback_failed = True
            if rollback_error is not None or remote_rollback_failed:
                raise RuntimeError(
                    "Unable to activate Portal IAM key. Local or IAM rollback also failed."
                ) from exc
            raise

        self._delete_stale_portal_keys(
            iam_service,
            link.iam_username,
            previous_keys,
            preserve_access_key=new_key.access_key_id,
        )
        return result

    @staticmethod
    def _delete_stale_portal_keys(
        iam_service: RGWIAMService,
        iam_username: str,
        keys: list[ModelAccessKey],
        *,
        preserve_access_key: str,
    ) -> None:
        for key in keys:
            if key.access_key_id == preserve_access_key:
                continue
            try:
                iam_service.delete_access_key(iam_username, key.access_key_id)
            except Exception as exc:  # pragma: no cover - defensive remote failure
                logger.warning(
                    "Unable to delete stale access key %s: %s",
                    key.access_key_id,
                    exc,
                )

    def _list_access_keys(
        self,
        link: AccountIAMUser,
        iam_service: RGWIAMService,
        include_portal: bool = False,
    ) -> list[PortalAccessKey]:
        if not link.iam_username:
            raise RuntimeError("IAM username missing for this portal user")
        metas = iam_service.list_access_keys(link.iam_username)
        keys: list[PortalAccessKey] = []
        for meta in metas:
            is_portal = meta.access_key_id == link.active_access_key
            if is_portal and not include_portal:
                continue
            is_active = is_portal or self._is_active_status(meta.status, default=True)
            keys.append(
                portal_access_key_from_iam_metadata(
                    meta,
                    is_portal=is_portal,
                    deletable=not is_portal,
                    is_active=is_active,
                )
            )
        # Ensure the active key is reflected even if IAM did not return metadata
        if include_portal and link.active_access_key and not any(k.access_key_id == link.active_access_key for k in keys):
            keys.insert(
                0,
                portal_access_key_from_active_link(link, include_secret=True),
            )
        return keys
