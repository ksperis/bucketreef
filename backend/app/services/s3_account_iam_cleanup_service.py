# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.sensitive_data import sanitized_error_log_detail
from app.db import S3Account, StorageEndpoint
from app.models.iam import IAMGroup, IAMRole, IAMUser
from app.services.managed_resource_naming import PORTAL_MANAGED_IAM_GROUP_NAMES
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.utils.s3_endpoint import resolve_iam_client_options
from app.utils.storage_endpoint_features import resolve_feature_flags


@dataclass(frozen=True)
class _AccountIAMDeletionInventory:
    users: list[IAMUser]
    groups: list[IAMGroup]
    roles: list[IAMRole]
    group_members: dict[str, list[IAMUser]]


class S3AccountIamCleanupService:
    """Validate and remove account-scoped IAM state before RGW account deletion."""

    def __init__(
        self,
        db: Session,
        *,
        iam_factory: Callable[[S3Account], RGWIAMService] | None = None,
    ) -> None:
        self.db = db
        self._iam_factory = iam_factory

    def prepare(self, account: S3Account, endpoint: StorageEndpoint) -> None:
        if not resolve_feature_flags(endpoint).iam_enabled:
            return

        iam = self._iam_factory(account) if self._iam_factory is not None else self._iam_for_account(account)
        inventory = self._load_inventory(iam)
        self._require_deletion_ready(inventory)
        self._remove_portal_groups(iam, inventory.groups)

    @staticmethod
    def _iam_for_account(account: S3Account) -> RGWIAMService:
        access_key, secret_key = account.effective_rgw_credentials()
        if not access_key or not secret_key:
            raise ValueError("Unable to verify RGW IAM resources; account root credentials are missing.")
        endpoint, region, verify_tls = resolve_iam_client_options(account)
        try:
            return get_iam_service(
                access_key,
                secret_key,
                endpoint=endpoint,
                region=region,
                verify_tls=verify_tls,
            )
        except Exception as exc:
            raise ValueError(
                f"Unable to initialize RGW IAM cleanup: {sanitized_error_log_detail(exc)}"
            ) from exc

    @staticmethod
    def _load_inventory(iam: RGWIAMService) -> _AccountIAMDeletionInventory:
        try:
            users = iam.list_users()
            groups = iam.list_groups()
            roles = iam.list_roles()
            group_members = {
                group.name: iam.list_group_users(group.name)
                for group in groups
            }
        except RuntimeError as exc:
            raise ValueError(
                f"Unable to verify RGW IAM resources; cannot delete the RGW tenant: {sanitized_error_log_detail(exc)}"
            ) from exc
        return _AccountIAMDeletionInventory(
            users=users,
            groups=groups,
            roles=roles,
            group_members=group_members,
        )

    @staticmethod
    def _require_deletion_ready(inventory: _AccountIAMDeletionInventory) -> None:
        unexpected_groups = sorted(
            group.name
            for group in inventory.groups
            if group.name not in PORTAL_MANAGED_IAM_GROUP_NAMES
        )
        groups_with_members = sorted(
            group_name
            for group_name, members in inventory.group_members.items()
            if members
        )
        if inventory.users or inventory.roles or unexpected_groups or groups_with_members:
            raise ValueError(
                "RGW tenant still has attached IAM resources "
                f"(users={len(inventory.users)}, roles={len(inventory.roles)}, "
                f"groups={len(unexpected_groups)}, groups_with_members={len(groups_with_members)}); "
                "remove them first."
            )

    @staticmethod
    def _remove_portal_groups(iam: RGWIAMService, groups: list[IAMGroup]) -> None:
        try:
            for group in groups:
                for policy_arn in group.policies or []:
                    iam.detach_group_policy(group.name, policy_arn)
                for policy_name in iam.list_group_inline_policies(group.name):
                    iam.delete_group_inline_policy(group.name, policy_name)
                iam.delete_group(group.name)
        except RuntimeError as exc:
            raise ValueError(
                f"Unable to remove Portal IAM groups; cannot delete the RGW tenant: {sanitized_error_log_detail(exc)}"
            ) from exc
