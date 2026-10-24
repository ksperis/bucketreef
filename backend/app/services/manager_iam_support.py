# Copyright (c) 2026 Laurent Barbe
# Licensed under the Apache License, Version 2.0
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.domain_errors import (
    ManagerIAMCredentialsMissingError,
    ManagerIAMManagedUserConflictError,
    ManagerIAMUserNotFoundError,
)
from app.db import AccountIAMUser
from app.models.iam import IAMUser, IAMUserUpdate
from app.models.policy import InlinePolicy, Policy
from app.services.access_key_metadata_service import AccessKeyMetadataService
from app.services.managed_private_access_service import ManagedPrivateAccessService
from app.services.managed_private_access_sources import iam_source_reference
from app.services.rgw_iam import RGWIAMService, get_iam_service
from app.services.s3_execution_context import S3ExecutionContext
from app.utils.s3_endpoint import resolve_iam_client_options


@dataclass(frozen=True)
class ManagerIAMUserUpdateResult:
    user: IAMUser
    previous_name: str | None
    name_updated: bool
    path_updated: bool


def managed_iam_user_source(
    db: Session,
    context: S3ExecutionContext,
    user_name: str,
) -> tuple[str, int | None] | None:
    source = iam_source_reference(context)
    if source is not None:
        provisioning = ManagedPrivateAccessService(db).managed_iam_user(*source, user_name)
        if provisioning is not None:
            return "private_access", provisioning.s3_connection_id
    if context.id is not None and (
        db.scalar(
            select(AccountIAMUser.id)
            .where(
                AccountIAMUser.account_id == context.id,
                AccountIAMUser.iam_username == user_name,
            )
            .limit(1)
        )
        is not None
    ):
        return "portal", None
    return None


def ensure_unmanaged_iam_user(db: Session, context: S3ExecutionContext, user_name: str) -> None:
    managed = managed_iam_user_source(db, context, user_name)
    if managed is None:
        return
    workflow = "private connection" if managed[0] == "private_access" else "Portal"
    raise ManagerIAMManagedUserConflictError(
        f"BucketReef-managed IAM users must be managed through their {workflow} workflow"
    )


def build_iam_service_for_context(context: S3ExecutionContext) -> RGWIAMService:
    access_key, secret_key = context.effective_rgw_credentials()
    if not access_key or not secret_key:
        raise ManagerIAMCredentialsMissingError("Execution context credentials are missing")
    endpoint, region, verify_tls = resolve_iam_client_options(context)
    return get_iam_service(
        access_key,
        secret_key,
        endpoint=endpoint,
        region=region,
        verify_tls=verify_tls,
    )


def load_iam_user_details(service: RGWIAMService, user: IAMUser) -> IAMUser:
    user.groups = [group.name for group in service.list_groups_for_user(user.name)]
    user.policies = [policy.arn for policy in service.list_user_policies(user.name) if policy.arn]
    inline = service.list_user_inline_policies(user.name)
    user.inline_policies = inline or None
    user.has_keys = bool(service.list_access_keys(user.name))
    return user


def update_iam_user(
    db: Session,
    context: S3ExecutionContext,
    service: RGWIAMService,
    user_name: str,
    payload: IAMUserUpdate,
) -> ManagerIAMUserUpdateResult:
    existing = service.get_user(user_name)
    if existing is None:
        raise ManagerIAMUserNotFoundError("User not found")
    ensure_unmanaged_iam_user(db, context, user_name)

    new_name = payload.name if payload.name is not None and payload.name != user_name else None
    new_path = payload.path if payload.path is not None and payload.path != existing.path else None
    service.update_user(user_name, new_name=new_name, new_path=new_path)

    effective_name = new_name or user_name
    if new_name is not None and context.id is not None:
        AccessKeyMetadataService(db).rename_iam_principal_metadata(
            context.id,
            user_name,
            effective_name,
        )
    updated = service.get_user(effective_name)
    if updated is None:
        raise RuntimeError("Updated IAM user could not be reloaded")
    return ManagerIAMUserUpdateResult(
        user=load_iam_user_details(service, updated),
        previous_name=user_name if new_name is not None else None,
        name_updated=new_name is not None,
        path_updated=new_path is not None,
    )


def validate_inline_policy_name(payload: InlinePolicy, policy_name: str) -> None:
    if payload.name and payload.name != policy_name:
        raise ValueError("Inline policy name in payload does not match the URL.")


def load_inline_policies(
    entity_name: str,
    *,
    list_names_fn: Callable[[str], list[str]],
    get_policy_fn: Callable[[str, str], dict[str, Any] | None],
) -> list[InlinePolicy]:
    names = list_names_fn(entity_name)
    policies: list[InlinePolicy] = []
    for name in names:
        document = get_policy_fn(entity_name, name) or {}
        policies.append(InlinePolicy(name=name, document=document))
    return policies


def save_inline_policy(
    entity_name: str,
    *,
    policy_name: str,
    document: dict[str, Any],
    put_policy_fn: Callable[[str, str, dict[str, Any]], None],
    get_policy_fn: Callable[[str, str], dict[str, Any] | None],
) -> InlinePolicy:
    put_policy_fn(entity_name, policy_name, document)
    saved = get_policy_fn(entity_name, policy_name) or document
    return InlinePolicy(name=policy_name, document=saved)


def resolve_attached_policy(
    payload: Policy,
    *,
    get_policy_fn: Callable[[str], Policy | None],
) -> Policy:
    fetched = get_policy_fn(payload.arn)
    if fetched:
        return fetched
    return Policy(
        name=payload.name,
        arn=payload.arn,
        path=payload.path,
        default_version_id=payload.default_version_id,
    )
